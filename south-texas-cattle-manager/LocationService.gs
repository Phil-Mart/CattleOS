function loc_normalizeZip(zip) {
  if (zip === null || zip === undefined) return '';
  if (typeof zip === 'number' && isFinite(zip) && Math.floor(zip) === zip && zip >= 0 && zip <= 99999) {
    return String(zip).padStart(5, '0');
  }
  return String(zip).trim();
}

function loc_validateZip(zip) {
  var normalized = loc_normalizeZip(zip);
  if (!normalized) {
    return { valid: false, zip: '', error: 'Enter a five-digit U.S. ZIP code.' };
  }
  if (/^\d{5}-\d{4}$/.test(normalized)) {
    return { valid: false, zip: normalized, error: 'ZIP+4 is not supported in Version 1.1. Enter exactly five digits.' };
  }
  if (!/^\d{5}$/.test(normalized)) {
    return { valid: false, zip: normalized, error: 'ZIP must contain exactly five digits. Leading zeroes are allowed.' };
  }
  return { valid: true, zip: normalized, error: '' };
}

function loc_validateExactCoordinates_(latitude, longitude) {
  var latBlank = latitude === null || latitude === undefined || String(latitude).trim() === '';
  var lngBlank = longitude === null || longitude === undefined || String(longitude).trim() === '';
  if (latBlank && lngBlank) return { provided: false, latitude: null, longitude: null };
  if (latBlank || lngBlank) throw new Error('Enter both exact latitude and exact longitude, or leave both blank.');
  var lat = Number(latitude);
  var lng = Number(longitude);
  if (!isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('Exact latitude must be a number from -90 to 90.');
  }
  if (!isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Exact longitude must be a number from -180 to 180.');
  }
  return { provided: true, latitude: lat, longitude: lng };
}

function loc_geocodeZip(zip, geocoderResponseOverride) {
  var validation = loc_validateZip(zip);
  if (!validation.valid) throw new Error(validation.error);
  var response = geocoderResponseOverride || Maps.newGeocoder().setRegion('US').geocode(validation.zip + ', USA');
  var result = loc_pickBestGeocodeResult_(response, validation.zip);
  if (!result) throw new Error('No U.S. geocoder result with valid coordinates was found for ZIP ' + validation.zip + '.');
  var parsed = loc_parseGeocodeResult_(result, validation.zip);
  if (!parsed.county && !geocoderResponseOverride) {
    var reverse = loc_reverseGeocode(parsed.latitude, parsed.longitude);
    parsed.county = reverse.county || '';
    if (!parsed.county) {
      parsed.data_quality_warning = 'County was not returned by ZIP geocoding or reverse geocoding.';
      audit_log('WARN', 'COUNTY_UNRESOLVED', 'County unresolved after geocoding.', { zip: validation.zip });
    }
  }
  parsed.location_source = 'ZIP Centroid';
  parsed.location_precision = 'Approximate';
  parsed.resolved_at = cattle_nowIso_();
  return parsed;
}

function loc_reverseGeocode(lat, lng, geocoderResponseOverride) {
  var coordinates = loc_validateExactCoordinates_(lat, lng);
  if (!coordinates.provided) throw new Error('Latitude and longitude are required for reverse geocoding.');
  var response = geocoderResponseOverride || Maps.newGeocoder().reverseGeocode(coordinates.latitude, coordinates.longitude);
  var results = response && response.results ? response.results : [];
  if (!results.length) return {};
  return loc_parseGeocodeResult_(results[0], '');
}

function loc_getRanchLocation() {
  settings_ensureDefaults();
  var zip = loc_normalizeZip(settings_get('Ranch_ZIP'));
  var lat = settings_get('Ranch_Latitude');
  var lng = settings_get('Ranch_Longitude');
  var exactPoint = risk_normalizePoint_({ latitude: lat, longitude: lng });
  var resolvedPoint = risk_normalizePoint_({
    latitude: settings_get('Resolved_Latitude'),
    longitude: settings_get('Resolved_Longitude')
  });
  var hasExact = exactPoint.valid;
  var storedSource = cattle_normalizeText_(settings_get('Location_Source'));
  return {
    zip: zip,
    city: cattle_normalizeText_(settings_get('Resolved_City')),
    county: cattle_normalizeText_(settings_get('Resolved_County')),
    state: cattle_normalizeText_(settings_get('Resolved_State')),
    latitude: hasExact ? exactPoint.lat : (resolvedPoint.valid ? resolvedPoint.lat : null),
    longitude: hasExact ? exactPoint.lng : (resolvedPoint.valid ? resolvedPoint.lng : null),
    location_source: hasExact ? 'Exact Coordinates' : (storedSource === 'Exact Coordinates' ? (zip ? 'ZIP Centroid' : '') : (storedSource || (zip ? 'ZIP Centroid' : ''))),
    location_precision: hasExact ? 'Exact coordinates supplied by user' : 'Approximate',
    resolved_at: settings_get('Location_Resolved_At') || ''
  };
}

function loc_saveRanchLocation(location) {
  if (!location) throw new Error('Location is required.');
  var zipValidation = loc_validateZip(location.zip);
  if (!zipValidation.valid) throw new Error(zipValidation.error);
  var coordinates = loc_validateExactCoordinates_(location.latitude, location.longitude);
  if (!coordinates.provided) throw new Error('Location must include valid latitude and longitude.');
  var source = location.location_source === 'Exact Coordinates' ? 'Exact Coordinates' : 'ZIP Centroid';
  settings_set('Ranch_ZIP', zipValidation.zip);
  settings_set('Resolved_City', location.city || '', { editable: false });
  settings_set('Resolved_County', location.county || '', { editable: false });
  settings_set('Resolved_State', location.state || '', { editable: false });
  settings_set('Resolved_Latitude', coordinates.latitude, { editable: false });
  settings_set('Resolved_Longitude', coordinates.longitude, { editable: false });
  if (source === 'Exact Coordinates') {
    settings_set('Ranch_Latitude', coordinates.latitude);
    settings_set('Ranch_Longitude', coordinates.longitude);
  } else {
    settings_set('Ranch_Latitude', '');
    settings_set('Ranch_Longitude', '');
  }
  settings_set('Location_Source', source, { editable: false });
  settings_set('Location_Resolved_At', location.resolved_at || cattle_nowIso_(), { editable: false });
  settings_syncZipToWatch_(zipValidation.zip);
  audit_log('INFO', 'SAVE_LOCATION', 'Ranch location saved.', {
    zip: zipValidation.zip,
    city: location.city,
    county: location.county,
    state: location.state,
    locationSource: location.location_source || 'ZIP Centroid'
  });
}

function loc_clearResolvedLocation(options) {
  options = options || {};
  var keys = ['Resolved_City', 'Resolved_County', 'Resolved_State', 'Resolved_Latitude', 'Resolved_Longitude', 'Location_Resolved_At', 'NWS_Last_Risk_JSON'];
  if (!options.preserveExact) {
    keys = keys.concat(['Ranch_Latitude', 'Ranch_Longitude', 'Location_Source']);
  }
  keys.forEach(function(key) {
    settings_set(key, '');
  });
  audit_log('INFO', 'CLEAR_LOCATION', 'Resolved ranch location cleared.', { preserveExact: !!options.preserveExact });
}

function loc_updateFromZip(zip) {
  var location = loc_geocodeZip(zip);
  var exactPoint = risk_normalizePoint_({
    latitude: settings_get('Ranch_Latitude'),
    longitude: settings_get('Ranch_Longitude')
  });
  if (exactPoint.valid && String(settings_get('Location_Source')) === 'Exact Coordinates') {
    location.latitude = exactPoint.lat;
    location.longitude = exactPoint.lng;
    location.location_source = 'Exact Coordinates';
    location.location_precision = 'Exact coordinates supplied by user';
    try {
      var reverse = loc_reverseGeocode(exactPoint.lat, exactPoint.lng);
      location.city = reverse.city || location.city;
      location.county = reverse.county || location.county;
      location.state = reverse.state || location.state;
    } catch (err) {
      audit_log('WARN', 'EXACT_COORDINATE_REVERSE_GEOCODE_FAILED', 'Exact coordinates were retained, but reverse geocoding failed.', {
        error: err.message
      });
    }
  }
  loc_saveRanchLocation(location);
  return location;
}

function loc_pickBestGeocodeResult_(response, zip) {
  var results = response && response.results ? response.results : [];
  var fallback = null;
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    var parsed = loc_parseGeocodeResult_(result, zip);
    if (!risk_normalizePoint_({ latitude: parsed.latitude, longitude: parsed.longitude }).valid || String(parsed.country).toUpperCase() !== 'US') continue;
    if (parsed.postal_code === zip) return result;
    if (!fallback) fallback = result;
  }
  return fallback;
}

function loc_parseGeocodeResult_(result, requestedZip) {
  var components = result && result.address_components ? result.address_components : [];
  var byType = {};
  components.forEach(function(component) {
    (component.types || []).forEach(function(type) {
      byType[type] = component;
    });
  });
  var location = result && result.geometry && result.geometry.location ? result.geometry.location : {};
  var latitude = location.lat === null || location.lat === undefined || location.lat === '' ? null : Number(location.lat);
  var longitude = location.lng === null || location.lng === undefined || location.lng === '' ? null : Number(location.lng);
  return {
    zip: requestedZip || loc_componentShort_(byType.postal_code),
    city: loc_componentLong_(byType.locality) || loc_componentLong_(byType.postal_town) || loc_componentLong_(byType.sublocality) || loc_componentLong_(byType.administrative_area_level_3),
    county: loc_componentLong_(byType.administrative_area_level_2),
    state: loc_componentShort_(byType.administrative_area_level_1),
    country: loc_componentShort_(byType.country),
    postal_code: loc_componentShort_(byType.postal_code),
    latitude: latitude,
    longitude: longitude,
    formatted_address: result && result.formatted_address ? result.formatted_address : ''
  };
}

function loc_componentLong_(component) {
  return component ? component.long_name || '' : '';
}

function loc_componentShort_(component) {
  return component ? component.short_name || component.long_name || '' : '';
}

function loc_buildResultWithRisk() {
  var location = loc_getRanchLocation();
  var zones = nws_getStoredZones_();
  var cases = nws_getStoredCases_();
  var health = nws_getDataHealth();
  return risk_evaluateRanchNwsStatus(location, zones, cases, health);
}
