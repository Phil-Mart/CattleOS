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
  if (!isFinite(Number(lat)) || !isFinite(Number(lng))) throw new Error('Latitude and longitude are required for reverse geocoding.');
  var response = geocoderResponseOverride || Maps.newGeocoder().reverseGeocode(Number(lat), Number(lng));
  var results = response && response.results ? response.results : [];
  if (!results.length) return {};
  return loc_parseGeocodeResult_(results[0], '');
}

function loc_getRanchLocation() {
  settings_ensureDefaults();
  var zip = loc_normalizeZip(settings_get('Ranch_ZIP'));
  var lat = settings_get('Ranch_Latitude');
  var lng = settings_get('Ranch_Longitude');
  var exactLat = cattle_toNumber_(lat, null);
  var exactLng = cattle_toNumber_(lng, null);
  var hasExact = exactLat !== null && exactLng !== null && Math.abs(exactLat) <= 90 && Math.abs(exactLng) <= 180;
  var storedSource = cattle_normalizeText_(settings_get('Location_Source'));
  return {
    zip: zip,
    city: cattle_normalizeText_(settings_get('Resolved_City')),
    county: cattle_normalizeText_(settings_get('Resolved_County')),
    state: cattle_normalizeText_(settings_get('Resolved_State')),
    latitude: hasExact ? exactLat : cattle_toNumber_(settings_get('Resolved_Latitude'), null),
    longitude: hasExact ? exactLng : cattle_toNumber_(settings_get('Resolved_Longitude'), null),
    location_source: hasExact ? 'Exact Coordinates' : (storedSource === 'Exact Coordinates' ? (zip ? 'ZIP Centroid' : '') : (storedSource || (zip ? 'ZIP Centroid' : ''))),
    location_precision: hasExact ? 'Exact coordinates supplied by user' : 'Approximate',
    resolved_at: settings_get('Location_Resolved_At') || ''
  };
}

function loc_saveRanchLocation(location) {
  if (!location) throw new Error('Location is required.');
  var zipValidation = loc_validateZip(location.zip);
  if (!zipValidation.valid) throw new Error(zipValidation.error);
  if (!isFinite(Number(location.latitude)) || !isFinite(Number(location.longitude))) {
    throw new Error('Location must include valid latitude and longitude.');
  }
  settings_set('Ranch_ZIP', zipValidation.zip);
  settings_set('Resolved_City', location.city || '', { editable: false });
  settings_set('Resolved_County', location.county || '', { editable: false });
  settings_set('Resolved_State', location.state || '', { editable: false });
  settings_set('Resolved_Latitude', location.latitude, { editable: false });
  settings_set('Resolved_Longitude', location.longitude, { editable: false });
  if ((location.location_source || 'ZIP Centroid') === 'Exact Coordinates') {
    settings_set('Ranch_Latitude', location.latitude);
    settings_set('Ranch_Longitude', location.longitude);
  }
  settings_set('Location_Source', location.location_source || 'ZIP Centroid', { editable: false });
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

function loc_clearResolvedLocation() {
  ['Resolved_City', 'Resolved_County', 'Resolved_State', 'Resolved_Latitude', 'Resolved_Longitude', 'Ranch_Latitude', 'Ranch_Longitude', 'Location_Source', 'Location_Resolved_At', 'NWS_Last_Risk_JSON'].forEach(function(key) {
    settings_set(key, '');
  });
  audit_log('INFO', 'CLEAR_LOCATION', 'Resolved ranch location cleared.', {});
}

function loc_updateFromZip(zip) {
  var location = loc_geocodeZip(zip);
  var existingLat = cattle_toNumber_(settings_get('Ranch_Latitude'), null);
  var existingLng = cattle_toNumber_(settings_get('Ranch_Longitude'), null);
  if (existingLat !== null && existingLng !== null && String(settings_get('Location_Source')) === 'Exact Coordinates') {
    location.latitude = existingLat;
    location.longitude = existingLng;
    location.location_source = 'Exact Coordinates';
    location.location_precision = 'Exact coordinates supplied by user';
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
    if (!parsed.latitude || !parsed.longitude || parsed.country !== 'US') continue;
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
  return {
    zip: requestedZip || loc_componentShort_(byType.postal_code),
    city: loc_componentLong_(byType.locality) || loc_componentLong_(byType.postal_town) || loc_componentLong_(byType.sublocality) || loc_componentLong_(byType.administrative_area_level_3),
    county: loc_componentLong_(byType.administrative_area_level_2),
    state: loc_componentShort_(byType.administrative_area_level_1),
    country: loc_componentShort_(byType.country),
    postal_code: loc_componentShort_(byType.postal_code),
    latitude: Number(location.lat),
    longitude: Number(location.lng),
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
