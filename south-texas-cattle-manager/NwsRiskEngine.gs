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
  for (var i = 0; i < ring.length; i++) {
    var a = risk_normalizePoint_(ring[i]);
    var b = risk_normalizePoint_(ring[(i + 1) % ring.length]);
    if (!a.valid || !b.valid) continue;
    var squaredLength = Math.pow(b.lng - a.lng, 2) + Math.pow(b.lat - a.lat, 2);
    if (squaredLength <= epsilon * epsilon) {
      if (Math.abs(p.lng - a.lng) <= epsilon && Math.abs(p.lat - a.lat) <= epsilon) return true;
      continue;
    }
    var cross = (p.lng - a.lng) * (b.lat - a.lat) - (p.lat - a.lat) * (b.lng - a.lng);
    if (Math.abs(cross) > epsilon) continue;
    var dot = (p.lng - a.lng) * (b.lng - a.lng) + (p.lat - a.lat) * (b.lat - a.lat);
    if (dot < -epsilon) continue;
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
    'Official zones may cover only part of a county',
    'Workbook zone geometry may be generalized by about 17 meters; verify boundary-adjacent properties on the official TAHC map'
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
    state: location && location.state ? cattle_normalizeText_(location.state).toUpperCase() : '',
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
  var zipValidation = loc_validateZip(result.zip);
  if (!zipValidation.valid) {
    result.official_zone_status = 'Unknown';
    result.explanation = 'A valid five-digit ranch ZIP is required before location-specific NWS results can be evaluated.';
    return result;
  }
  result.zip = zipValidation.zip;
  if (!result.state) {
    result.official_zone_status = 'Unknown';
    result.explanation = 'The ranch state could not be resolved from the configured location.';
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
  if (!cattle_normalizeCounty_(result.county)) {
    result.official_zone_status = 'Unknown';
    result.operational_attention = 'Data Unavailable';
    result.explanation = 'The ranch county could not be resolved, so county-level official zone records cannot be evaluated safely.';
    return result;
  }

  var county = cattle_normalizeCounty_(result.county);
  var insideInfested = false;
  var insideSurveillance = false;
  var insideUnclassifiedZone = false;
  var countyInfested = false;
  var countyAnyZone = false;
  var partialCountyUncertain = false;
  var relevantZoneNames = [];

  (zones || []).forEach(function(zone) {
    if (!risk_zoneIsActive_(zone)) return;
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
      else if (zoneType === 'Surveillance Zone') insideSurveillance = true;
      else insideUnclassifiedZone = true;
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
  } else if (insideUnclassifiedZone) {
    result.official_zone_status = 'Unknown';
    result.operational_attention = 'Data Unavailable';
    result.explanation = 'An official polygon contains the configured location, but its zone type could not be interpreted safely. Verify status on the official TAHC map.';
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
    var point = risk_normalizePoint_([esriGeometry.x, esriGeometry.y]);
    return point.valid ? { type: 'Point', coordinates: [point.lng, point.lat] } : null;
  }
  if (esriGeometry.rings) {
    var rings = esriGeometry.rings.map(function(ring) {
      return risk_closeRing_(ring);
    }).filter(function(ring) {
      return ring.length >= 4 && ring.every(function(point) { return risk_normalizePoint_(point).valid; });
    });
    var polygons = risk_groupEsriRings_(rings);
    if (!polygons.length) return null;
    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  }
  if (esriGeometry.paths) {
    return { type: 'MultiLineString', coordinates: esriGeometry.paths };
  }
  return null;
}

function risk_normalizePoint_(point) {
  if (point == null) return { valid: false };
  function blank(value) {
    return value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '';
  }
  var rawLng;
  var rawLat;
  var lng;
  var lat;
  if (Array.isArray(point)) {
    rawLng = point[0];
    rawLat = point[1];
  } else if (point.coordinates && Array.isArray(point.coordinates)) {
    rawLng = point.coordinates[0];
    rawLat = point.coordinates[1];
  } else {
    rawLat = point.latitude !== undefined ? point.latitude : point.lat;
    rawLng = point.longitude !== undefined ? point.longitude : point.lng;
  }
  if (blank(rawLat) || blank(rawLng)) return { valid: false };
  lat = Number(rawLat);
  lng = Number(rawLng);
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
  if (typeof json === 'string' && json) return nws_parseGeometryCell_(json);
  return null;
}

function risk_distanceToGeometryMiles_(point, geometry) {
  if (!geometry) return null;
  if (risk_geometryContainsPoint_(geometry, point)) return 0;
  if (geometry.type === 'Point') return risk_haversineMiles(point, geometry.coordinates);
  if (geometry.type === 'Polygon') return risk_minDistanceToRings_(point, geometry.coordinates || []);
  if (geometry.type === 'MultiPolygon') {
    var polygonMin = null;
    (geometry.coordinates || []).forEach(function(polygon) {
      var distance = risk_minDistanceToRings_(point, polygon || []);
      if (distance !== null && (polygonMin === null || distance < polygonMin)) polygonMin = distance;
    });
    return polygonMin;
  }
  if (geometry.type === 'LineString') return risk_minDistanceToPath_(point, geometry.coordinates || []);
  if (geometry.type === 'MultiLineString') {
    var lineMin = null;
    (geometry.coordinates || []).forEach(function(path) {
      var distance = risk_minDistanceToPath_(point, path || []);
      if (distance !== null && (lineMin === null || distance < lineMin)) lineMin = distance;
    });
    return lineMin;
  }
  var coords = risk_flattenCoordinates_(geometry.coordinates || []);
  var min = null;
  for (var i = 0; i < coords.length; i++) {
    var distance = risk_haversineMiles(point, coords[i]);
    if (distance !== null && (min === null || distance < min)) min = distance;
  }
  return min;
}

function risk_minDistanceToRings_(point, rings) {
  var min = null;
  (rings || []).forEach(function(ring) {
    var distance = risk_minDistanceToPath_(point, ring, true);
    if (distance !== null && (min === null || distance < min)) min = distance;
  });
  return min;
}

function risk_minDistanceToPath_(point, path, closePath) {
  if (!path || !path.length) return null;
  if (path.length === 1) return risk_haversineMiles(point, path[0]);
  var min = null;
  var segmentCount = closePath ? path.length : path.length - 1;
  for (var i = 0; i < segmentCount; i++) {
    var next = (i + 1) % path.length;
    var distance = risk_distancePointToSegmentMiles_(point, path[i], path[next]);
    if (distance !== null && (min === null || distance < min)) min = distance;
  }
  return min;
}

function risk_distancePointToSegmentMiles_(point, segmentStart, segmentEnd) {
  var p = risk_normalizePoint_(point);
  var a = risk_normalizePoint_(segmentStart);
  var b = risk_normalizePoint_(segmentEnd);
  if (!p.valid || !a.valid || !b.valid) return null;
  var milesPerLatitudeDegree = 69.0;
  var milesPerLongitudeDegree = 69.172 * Math.cos(risk_toRadians_(p.lat));
  var ax = (a.lng - p.lng) * milesPerLongitudeDegree;
  var ay = (a.lat - p.lat) * milesPerLatitudeDegree;
  var bx = (b.lng - p.lng) * milesPerLongitudeDegree;
  var by = (b.lat - p.lat) * milesPerLatitudeDegree;
  var dx = bx - ax;
  var dy = by - ay;
  var lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return risk_haversineMiles(p, a);
  var t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  var nearestX = ax + t * dx;
  var nearestY = ay + t * dy;
  return Math.sqrt(nearestX * nearestX + nearestY * nearestY);
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
  return text.split(/[,;/|]+|\s+and\s+|\s*&\s*/i).some(function(part) {
    return cattle_normalizeCounty_(part) === county;
  }) || cattle_normalizeCounty_(text) === county;
}

function risk_hasMappableCountyZone_(zones, county) {
  return (zones || []).some(function(zone) {
    return risk_zoneIsActive_(zone) &&
      risk_countyListMatches_(zone.County_Names || zone.county || zone.County || '', county) &&
      !!risk_featureGeometry_(zone);
  });
}

function risk_zoneIsActive_(zone) {
  zone = zone || {};
  var status = cattle_normalizeText_(zone.Official_Status || zone.official_status || zone.status).toLowerCase();
  if (/\b(inactive|expired|released|ended|archived|closed)\b/.test(status) || /^(false|0|no)$/.test(status)) return false;
  var now = new Date();
  var effective = cattle_parseDate_(zone.Effective_Date || zone.effective_date);
  var end = cattle_parseDate_(zone.End_Date || zone.end_date);
  if (effective && effective.getTime() > now.getTime()) return false;
  if (end) {
    end.setHours(23, 59, 59, 999);
    if (end.getTime() < now.getTime()) return false;
  }
  return true;
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

function risk_groupEsriRings_(rings) {
  var nodes = (rings || []).map(function(ring) {
    return {
      ring: ring,
      area: Math.abs(risk_ringArea_(ring)),
      parent: -1,
      depth: 0,
      polygonIndex: -1
    };
  }).filter(function(node) {
    return node.area > 0;
  }).sort(function(a, b) {
    return b.area - a.area;
  });

  for (var i = 0; i < nodes.length; i++) {
    var point = nodes[i].ring[0];
    var parent = -1;
    for (var j = 0; j < i; j++) {
      if (!risk_pointInRing_(risk_normalizePoint_(point), nodes[j].ring) && !risk_pointOnBoundary(point, nodes[j].ring)) continue;
      if (parent === -1 || nodes[j].area < nodes[parent].area) parent = j;
    }
    nodes[i].parent = parent;
    nodes[i].depth = parent === -1 ? 0 : nodes[parent].depth + 1;
  }

  var polygons = [];
  nodes.forEach(function(node, index) {
    if (node.depth % 2 === 0) {
      node.polygonIndex = polygons.length;
      polygons.push([node.ring]);
      return;
    }
    var ancestor = node.parent;
    while (ancestor !== -1 && nodes[ancestor].depth % 2 !== 0) ancestor = nodes[ancestor].parent;
    if (ancestor !== -1 && nodes[ancestor].polygonIndex !== -1) {
      polygons[nodes[ancestor].polygonIndex].push(node.ring);
    }
  });
  return polygons;
}

function risk_ringArea_(ring) {
  var area = 0;
  for (var i = 0; i < (ring || []).length - 1; i++) {
    area += Number(ring[i][0]) * Number(ring[i + 1][1]) -
      Number(ring[i + 1][0]) * Number(ring[i][1]);
  }
  return area / 2;
}
