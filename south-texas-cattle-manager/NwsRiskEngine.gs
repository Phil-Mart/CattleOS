function risk_pointInPolygon(point, polygon) {
  var normalizedPoint = risk_normalizePoint_(point);
  if (!normalizedPoint.valid) return false;
  var rings = risk_polygonCoordinates_(polygon);
  if (!rings || !rings.length || !rings[0].length) return false;
  if (risk_pointOnBoundary(normalizedPoint, rings[0])) return true;
  var insideOuter = risk_pointInRing_(normalizedPoint, rings[0]);
  if (!insideOuter) return false;
  for (var i = 1; i < rings.length; i++) {
    if (risk_pointOnBoundary(normalizedPoint, rings[i])) return true;
    if (risk_pointInRing_(normalizedPoint, rings[i])) return false;
  }
  return true;
}

function risk_pointInMultiPolygon(point, multiPolygon) {
  var polygons = risk_multiPolygonCoordinates_(multiPolygon);
  if (!polygons || !polygons.length) return false;
  for (var i = 0; i < polygons.length; i++) {
    if (risk_pointInPolygon(point, polygons[i])) return true;
  }
  return false;
}

function risk_pointOnBoundary(point, ring) {
  var p = risk_normalizePoint_(point);
  if (!p.valid || !ring || ring.length < 2) return false;
  var epsilon = 1e-9;
  for (var i = 0; i < ring.length - 1; i++) {
    var a = risk_normalizePoint_(ring[i]);
    var b = risk_normalizePoint_(ring[i + 1]);
    if (!a.valid || !b.valid) continue;
    var cross = (p.lng - a.lng) * (b.lat - a.lat) - (p.lat - a.lat) * (b.lng - a.lng);
    if (Math.abs(cross) > epsilon) continue;
    var dot = (p.lng - a.lng) * (b.lng - a.lng) + (p.lat - a.lat) * (b.lat - a.lat);
    if (dot < -epsilon) continue;
    var squaredLength = Math.pow(b.lng - a.lng, 2) + Math.pow(b.lat - a.lat, 2);
    if (dot - squaredLength <= epsilon) return true;
  }
  return false;
}

function risk_haversineMiles(pointA, pointB) {
  var a = risk_normalizePoint_(pointA);
  var b = risk_normalizePoint_(pointB);
  if (!a.valid || !b.valid) return null;
  var radiusMiles = 3958.7613;
  var dLat = risk_toRadians_(b.lat - a.lat);
  var dLng = risk_toRadians_(b.lng - a.lng);
  var lat1 = risk_toRadians_(a.lat);
  var lat2 = risk_toRadians_(b.lat);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

function risk_minDistanceToFeatures(point, features) {
  var p = risk_normalizePoint_(point);
  if (!p.valid || !features || !features.length) return null;
  var min = null;
  features.forEach(function(feature) {
    var geometry = risk_featureGeometry_(feature);
    var distance = risk_distanceToGeometryMiles_(p, geometry);
    if (distance !== null && (min === null || distance < min)) min = distance;
  });
  return min;
}

function risk_evaluateRanchNwsStatus(location, zones, cases, dataHealth) {
  var health = risk_normalizeDataHealth_(dataHealth);
  var caveats = [
    'ZIP centroid is not the exact ranch location',
    'Official zones may cover only part of a county'
  ];
  var sourceLinks = [
    { label: 'Texas Animal Health Commission NWS page', url: CATTLEOS.TAHC_PAGE_URL },
    { label: 'Official TAHC interactive map', url: CATTLEOS.TAHC_MAP_URL },
    { label: 'USDA confirmed detections', url: CATTLEOS.USDA_CASES_URL }
  ];
  var result = {
    zip: location && location.zip ? String(location.zip) : '',
    city: location && location.city ? String(location.city) : '',
    county: location && location.county ? String(location.county) : '',
    state: location && location.state ? String(location.state).toUpperCase() : '',
    latitude: location ? location.latitude : null,
    longitude: location ? location.longitude : null,
    location_source: location && location.location_source ? location.location_source : '',
    location_precision: location && location.location_precision ? location.location_precision : '',
    resolved_at: location && location.resolved_at ? location.resolved_at : '',
    official_zone_status: 'Unknown',
    operational_attention: 'Data Unavailable',
    nearest_detection_miles: null,
    nearest_detection_county: '',
    official_data_health: health.state,
    official_data_refreshed_at: health.lastSuccess || '',
    caveats: caveats,
    source_links: sourceLinks,
    explanation: '',
    evaluated_at: cattle_nowIso_()
  };

  var point = risk_normalizePoint_(location || {});
  if (!result.zip && !point.valid) {
    result.official_zone_status = 'Unknown';
    result.explanation = 'Ranch ZIP or coordinates are not configured.';
    return result;
  }
  if (result.state && result.state !== 'TX') {
    result.official_zone_status = 'Non-Texas Location';
    result.operational_attention = health.state === 'Unavailable' ? 'Data Unavailable' : 'Routine';
    result.explanation = 'Texas-specific zone logic not applicable to this location.';
    result.caveats.push('Texas-specific zone logic not applicable to this location');
    return result;
  }
  if (health.state === 'Unavailable' || health.state === 'Not Initialized') {
    result.official_zone_status = 'Texas Zone Data Unavailable';
    result.operational_attention = 'Data Unavailable';
    result.explanation = 'Official zone data are unavailable or hard stale. Verify status directly with TAHC before moving animals.';
    return result;
  }
  if (!point.valid) {
    result.official_zone_status = 'Unknown';
    result.operational_attention = 'Data Unavailable';
    result.explanation = 'Location could not be resolved to coordinates.';
    return result;
  }

  var county = cattle_normalizeCounty_(result.county);
  var insideInfested = false;
  var insideSurveillance = false;
  var countyInfested = false;
  var countyAnyZone = false;
  var partialCountyUncertain = false;
  var relevantZoneNames = [];

  (zones || []).forEach(function(zone) {
    var zoneType = risk_normalizeZoneType_(zone.Zone_Type || zone.zone_type || zone.type);
    var zoneCountyText = zone.County_Names || zone.county || zone.County || '';
    var zoneCountyMatch = risk_countyListMatches_(zoneCountyText, county);
    var geometry = risk_featureGeometry_(zone);
    var hasGeometry = !!geometry;
    var contains = false;
    if (hasGeometry) {
      contains = risk_geometryContainsPoint_(geometry, point);
    }
    if (zoneCountyMatch) {
      countyAnyZone = true;
      if (zoneType === 'Infested Zone') countyInfested = true;
      if (hasGeometry && !contains) partialCountyUncertain = true;
    }
    if (contains) {
      relevantZoneNames.push(zone.Zone_Name || zone.zone_name || zoneType);
      if (zoneType === 'Infested Zone') insideInfested = true;
      else insideSurveillance = true;
    }
    if (!hasGeometry && zoneCountyMatch && zoneType === 'Infested Zone') {
      relevantZoneNames.push(zone.Zone_Name || 'County-level infested zone');
    }
  });

  var nearest = risk_nearestDetection_(point, cases || []);
  result.nearest_detection_miles = nearest ? nearest.miles : null;
  result.nearest_detection_county = nearest ? nearest.county : '';
  var threshold = settings_getNumber ? settings_getNumber('NWS_Proximity_Warning_Miles', 50) : 50;
  var nearDetection = nearest && nearest.miles <= threshold;

  if (insideInfested) {
    result.official_zone_status = 'Inside Mapped Infested Zone';
    result.operational_attention = 'Critical';
    result.explanation = (result.location_source || 'Configured location') + ' appears inside a mapped infested zone. Verify exact property status with TAHC.';
  } else if (countyInfested && !insideInfested && (!zones || !risk_hasMappableCountyZone_(zones, county))) {
    result.official_zone_status = 'Affected County — Exact Position Uncertain';
    result.operational_attention = 'Critical';
    result.explanation = 'The county contains an official infested zone. This does not establish whether the ranch itself is inside the regulated polygon.';
  } else if (insideSurveillance) {
    result.official_zone_status = 'Inside Mapped Surveillance Zone';
    result.operational_attention = 'Heightened';
    result.explanation = 'Configured location appears inside an official surveillance or adjacent zone.';
  } else if (countyAnyZone || partialCountyUncertain) {
    result.official_zone_status = 'Affected County — Exact Position Uncertain';
    result.operational_attention = 'Heightened';
    result.explanation = 'The resolved county has official zone records, but the configured point is not clearly inside a mapped polygon.';
  } else {
    result.official_zone_status = 'Outside Currently Mapped Texas Zone';
    result.operational_attention = 'Routine';
    result.explanation = 'Current available Texas zone geometry does not place the configured location in a mapped zone.';
  }

  if (nearDetection && result.operational_attention === 'Routine') {
    result.operational_attention = 'Heightened';
    result.explanation = 'A confirmed detection is within the configured operational proximity threshold. This threshold is not an official regulatory boundary.';
  }
  if (health.state === 'Delayed' && result.operational_attention === 'Routine') {
    result.operational_attention = 'Heightened';
    result.explanation = 'Official data are delayed; keep inspection attention heightened until current data are available.';
  }
  if (health.state === 'Demo') {
    result.official_data_health = 'Demo';
    result.caveats.push('DEMO DATA — NOT CURRENT OUTBREAK INFORMATION');
  }
  if (relevantZoneNames.length) {
    result.relevant_zone_names = relevantZoneNames.slice(0, 5);
  }
  return result;
}

function risk_geometryContainsPoint_(geometry, point) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return risk_pointInPolygon(point, geometry);
  if (geometry.type === 'MultiPolygon') return risk_pointInMultiPolygon(point, geometry);
  if (geometry.type === 'Point') return risk_haversineMiles(point, geometry.coordinates) === 0;
  return false;
}

function risk_esriGeometryToGeoJson(esriGeometry) {
  if (!esriGeometry) return null;
  if (esriGeometry.x !== undefined && esriGeometry.y !== undefined) {
    return { type: 'Point', coordinates: [Number(esriGeometry.x), Number(esriGeometry.y)] };
  }
  if (esriGeometry.rings) {
    return { type: 'Polygon', coordinates: esriGeometry.rings.map(function(ring) {
      return risk_closeRing_(ring);
    }) };
  }
  if (esriGeometry.paths) {
    return { type: 'MultiLineString', coordinates: esriGeometry.paths };
  }
  return null;
}

function risk_normalizePoint_(point) {
  if (point == null) return { valid: false };
  var lng;
  var lat;
  if (Array.isArray(point)) {
    lng = Number(point[0]);
    lat = Number(point[1]);
  } else if (point.coordinates && Array.isArray(point.coordinates)) {
    lng = Number(point.coordinates[0]);
    lat = Number(point.coordinates[1]);
  } else {
    lat = Number(point.latitude !== undefined ? point.latitude : point.lat);
    lng = Number(point.longitude !== undefined ? point.longitude : point.lng);
  }
  var valid = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return { lat: lat, lng: lng, latitude: lat, longitude: lng, valid: valid };
}

function risk_polygonCoordinates_(polygon) {
  if (!polygon) return null;
  if (polygon.type === 'Polygon') return polygon.coordinates;
  if (Array.isArray(polygon) && polygon.length && Array.isArray(polygon[0])) return polygon;
  return null;
}

function risk_multiPolygonCoordinates_(multiPolygon) {
  if (!multiPolygon) return null;
  if (multiPolygon.type === 'MultiPolygon') return multiPolygon.coordinates;
  if (Array.isArray(multiPolygon)) return multiPolygon;
  return null;
}

function risk_pointInRing_(point, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var pi = risk_normalizePoint_(ring[i]);
    var pj = risk_normalizePoint_(ring[j]);
    if (!pi.valid || !pj.valid) continue;
    var intersects = ((pi.lat > point.lat) !== (pj.lat > point.lat)) &&
      (point.lng < (pj.lng - pi.lng) * (point.lat - pi.lat) / (pj.lat - pi.lat) + pi.lng);
    if (intersects) inside = !inside;
  }
  return inside;
}

function risk_toRadians_(degrees) {
  return Number(degrees) * Math.PI / 180;
}

function risk_featureGeometry_(feature) {
  if (!feature) return null;
  if (feature.type && feature.coordinates) return feature;
  if (feature.geometry) return feature.geometry.type ? feature.geometry : risk_esriGeometryToGeoJson(feature.geometry);
  var json = feature.Geometry_GeoJSON || feature.geometry_geojson || feature.Geometry || '';
  if (typeof json === 'string' && json) return cattle_parseJsonSafe_(json, null);
  return null;
}

function risk_distanceToGeometryMiles_(point, geometry) {
  if (!geometry) return null;
  if (risk_geometryContainsPoint_(geometry, point)) return 0;
  if (geometry.type === 'Point') return risk_haversineMiles(point, geometry.coordinates);
  var coords = risk_flattenCoordinates_(geometry.coordinates || []);
  var min = null;
  for (var i = 0; i < coords.length; i++) {
    var distance = risk_haversineMiles(point, coords[i]);
    if (distance !== null && (min === null || distance < min)) min = distance;
  }
  return min;
}

function risk_flattenCoordinates_(coords) {
  if (!Array.isArray(coords)) return [];
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') return [coords];
  var out = [];
  coords.forEach(function(child) {
    out = out.concat(risk_flattenCoordinates_(child));
  });
  return out;
}

function risk_nearestDetection_(point, cases) {
  var nearest = null;
  (cases || []).forEach(function(record) {
    var lat = record.Latitude !== undefined ? record.Latitude : record.latitude;
    var lng = record.Longitude !== undefined ? record.Longitude : record.longitude;
    var casePoint = risk_normalizePoint_({ latitude: lat, longitude: lng });
    if (!casePoint.valid) return;
    var miles = risk_haversineMiles(point, casePoint);
    if (miles !== null && (nearest === null || miles < nearest.miles)) {
      nearest = {
        miles: miles,
        county: record.County || record.county || '',
        record: record
      };
    }
  });
  return nearest;
}

function risk_countyListMatches_(zoneCountyText, county) {
  if (!county) return false;
  var text = cattle_normalizeText_(zoneCountyText);
  if (!text) return false;
  return text.split(/[,;/|]+/).some(function(part) {
    return cattle_normalizeCounty_(part) === county;
  }) || cattle_normalizeCounty_(text) === county;
}

function risk_hasMappableCountyZone_(zones, county) {
  return (zones || []).some(function(zone) {
    return risk_countyListMatches_(zone.County_Names || zone.county || zone.County || '', county) && !!risk_featureGeometry_(zone);
  });
}

function risk_normalizeZoneType_(type) {
  var text = cattle_normalizeText_(type).toLowerCase();
  if (!text) return 'Unknown';
  if (text.indexOf('infested') !== -1) return 'Infested Zone';
  if (text.indexOf('adjacent') !== -1 || text.indexOf('surveillance') !== -1) return 'Surveillance Zone';
  if (text.indexOf('zone') !== -1) return 'Other Official Zone';
  return 'Unknown';
}

function risk_normalizeDataHealth_(dataHealth) {
  if (typeof dataHealth === 'string') return { state: dataHealth, lastSuccess: '' };
  dataHealth = dataHealth || {};
  return {
    state: dataHealth.state || dataHealth.health || settings_get('NWS_Data_Health', 'Not Initialized'),
    lastSuccess: dataHealth.lastSuccess || dataHealth.last_success || settings_get('NWS_Last_Successful_Refresh', '')
  };
}

function risk_closeRing_(ring) {
  if (!ring || !ring.length) return ring || [];
  var first = ring[0];
  var last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return ring.concat([[first[0], first[1]]]);
}
