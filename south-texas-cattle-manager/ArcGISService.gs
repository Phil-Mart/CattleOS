var ARC_FIELD_CANDIDATES = {
  zone_type: ['zone_type', 'zonetype', 'zone_name', 'zone_abbr', 'zone', 'status', 'type', 'category'],
  zone_name: ['zone_name', 'zonename', 'name', 'title'],
  county: ['county', 'county_name', 'countyname', 'counties'],
  effective_date: ['effective_date', 'effectivedate', 'start_date', 'startdate', 'order_date'],
  case_status: ['case_status', 'status', 'active', 'disposition'],
  confirmation_date: ['confirmation_date', 'confirmed_date', 'detection_date', 'date'],
  animal_type: ['animal_type', 'animaltype', 'host', 'species', 'category'],
  detection_type: ['detection_type', 'detectiontype', 'type', 'category']
};

function arc_getItemMetadata(itemId) {
  var url = 'https://www.arcgis.com/sharing/rest/content/items/' + encodeURIComponent(itemId) + '?f=json';
  return arc_fetchJson_(url, { cacheSeconds: 1800, sourceKey: 'arcgis-item-metadata' });
}

function arc_getItemData(itemId) {
  var url = 'https://www.arcgis.com/sharing/rest/content/items/' + encodeURIComponent(itemId) + '/data?f=json';
  return arc_fetchJson_(url, { cacheSeconds: 1800, sourceKey: 'arcgis-item-data' });
}

function arc_resolveOperationalLayers(appItemId) {
  var appData = arc_getItemData(appItemId);
  var webMapIds = arc_findWebMapIds_(appData);
  var layers = [];
  if (appData && appData.operationalLayers) {
    layers = layers.concat(arc_flattenOperationalLayers_(appData.operationalLayers, 'app'));
  }
  webMapIds.forEach(function(webMapId) {
    try {
      var data = arc_getItemData(webMapId);
      layers = layers.concat(arc_flattenOperationalLayers_(data && data.operationalLayers ? data.operationalLayers : [], webMapId));
    } catch (err) {
      audit_log('WARN', 'ARCGIS_WEBMAP_DISCOVERY_FAILED', 'Could not inspect referenced web map.', { webMapId: webMapId, error: err.message });
    }
  });
  var deduped = {};
  layers.forEach(function(layer) {
    var key = (layer.url || layer.itemId || layer.id || layer.title || '') + ':' +
      (layer.layerId || '') + ':' + (layer.definitionExpression || '');
    if (!key || deduped[key]) return;
    deduped[key] = layer;
  });
  return Object.keys(deduped).map(function(key) {
    var layer = deduped[key];
    layer.role = arc_identifyLayerRole_(layer);
    return layer;
  });
}

function arc_getServiceMetadata(serviceUrl) {
  var url = arc_stripTrailingSlash_(serviceUrl) + '?f=json';
  return arc_fetchJson_(url, { cacheSeconds: 1800, sourceKey: 'arcgis-service-metadata' });
}

function arc_queryLayerGeoJson(layerUrl, options) {
  options = options || {};
  var params = {
    where: options.where || '1=1',
    outFields: options.outFields || '*',
    returnGeometry: options.returnGeometry === false ? 'false' : 'true',
    outSR: options.outSR || '4326',
    f: 'geojson'
  };
  if (options.geometryPrecision !== undefined) params.geometryPrecision = options.geometryPrecision;
  if (options.maxAllowableOffset !== undefined) params.maxAllowableOffset = options.maxAllowableOffset;
  var queryUrl = arc_stripTrailingSlash_(layerUrl) + '/query?' + arc_encodeParams_(params);
  var response = arc_fetch_(queryUrl, { sourceKey: 'arcgis-layer-query', allowNonJson: true });
  var text = response.text || '';
  var contentType = response.contentType || '';
  if (response.code >= 200 && response.code < 300 && contentType.indexOf('json') !== -1) {
    var parsed = cattle_parseJsonSafe_(text, null);
    if (parsed && parsed.type === 'FeatureCollection') {
      if (parsed.exceededTransferLimit) throw new Error('ArcGIS query exceeded the public layer transfer limit; refusing to evaluate a partial snapshot.');
      return parsed;
    }
    if (parsed && parsed.error && /geojson/i.test(parsed.error.message || '')) {
      return arc_queryLayerEsriJson_(layerUrl, options);
    }
    if (parsed && parsed.features) {
      if (parsed.exceededTransferLimit) throw new Error('ArcGIS query exceeded the public layer transfer limit; refusing to evaluate a partial snapshot.');
      return parsed;
    }
  }
  return arc_queryLayerEsriJson_(layerUrl, options);
}

function arc_queryLayerEsriJson_(layerUrl, options) {
  options = options || {};
  var params = {
    where: options.where || '1=1',
    outFields: options.outFields || '*',
    returnGeometry: options.returnGeometry === false ? 'false' : 'true',
    outSR: options.outSR || '4326',
    f: 'json'
  };
  if (options.geometryPrecision !== undefined) params.geometryPrecision = options.geometryPrecision;
  if (options.maxAllowableOffset !== undefined) params.maxAllowableOffset = options.maxAllowableOffset;
  var queryUrl = arc_stripTrailingSlash_(layerUrl) + '/query?' + arc_encodeParams_(params);
  var parsed = arc_fetchJson_(queryUrl, { sourceKey: 'arcgis-layer-query-json' });
  if (parsed && parsed.error) {
    throw new Error('ArcGIS layer query failed: ' + (parsed.error.message || JSON.stringify(parsed.error)));
  }
  if (parsed && parsed.exceededTransferLimit) {
    throw new Error('ArcGIS query exceeded the public layer transfer limit; refusing to evaluate a partial snapshot.');
  }
  return arc_esriFeatureSetToGeoJson_(parsed);
}

function arc_normalizeFeatures(rawFeatures, mapping) {
  var features = rawFeatures && rawFeatures.type === 'FeatureCollection' ? rawFeatures.features : (rawFeatures && rawFeatures.features ? rawFeatures.features : []);
  return features.map(function(feature, index) {
    var attributes = feature.properties || feature.attributes || {};
    var geometry = feature.geometry && feature.geometry.type ? feature.geometry : risk_esriGeometryToGeoJson(feature.geometry);
    var normalized = {
      source_feature_id: arc_findObjectId_(attributes, index),
      zone_type: arc_findMappedValue_(attributes, mapping, 'zone_type') || '',
      zone_name: arc_findMappedValue_(attributes, mapping, 'zone_name') || '',
      county: arc_findMappedValue_(attributes, mapping, 'county') || '',
      effective_date: arc_findMappedValue_(attributes, mapping, 'effective_date') || '',
      case_status: arc_findMappedValue_(attributes, mapping, 'case_status') || '',
      confirmation_date: arc_findMappedValue_(attributes, mapping, 'confirmation_date') || '',
      animal_type: arc_findMappedValue_(attributes, mapping, 'animal_type') || '',
      detection_type: arc_findMappedValue_(attributes, mapping, 'detection_type') || '',
      geometry: geometry,
      geometry_type: geometry ? geometry.type : '',
      raw_attributes: attributes
    };
    normalized.zone_type = risk_normalizeZoneType_(normalized.zone_type);
    return normalized;
  });
}

function arc_testPublicAccess() {
  try {
    var metadata = arc_getItemMetadata(CATTLEOS.TAHC_ARCGIS_ITEM_ID);
    var data = arc_getItemData(CATTLEOS.TAHC_ARCGIS_ITEM_ID);
    return {
      ok: !!(metadata && data),
      itemTitle: metadata && metadata.title ? metadata.title : '',
      access: metadata && metadata.access ? metadata.access : '',
      checkedAt: cattle_nowIso_()
    };
  } catch (err) {
    return { ok: false, error: err.message, checkedAt: cattle_nowIso_() };
  }
}

function arc_buildFieldMapping_(serviceMetadata, sampleAttributes) {
  var fieldLookup = {};
  var domains = {};
  (serviceMetadata && serviceMetadata.fields ? serviceMetadata.fields : []).forEach(function(field) {
    [field.name, field.alias].forEach(function(name) {
      if (name) fieldLookup[arc_fieldKey_(name)] = field.name;
    });
    var codedValues = field.domain && field.domain.codedValues ? field.domain.codedValues : [];
    if (codedValues.length) {
      domains[field.name] = {};
      codedValues.forEach(function(entry) {
        domains[field.name][String(entry.code)] = entry.name;
      });
    }
  });
  Object.keys(sampleAttributes || {}).forEach(function(name) {
    fieldLookup[arc_fieldKey_(name)] = name;
  });
  var mapping = {};
  Object.keys(ARC_FIELD_CANDIDATES).forEach(function(concept) {
    var candidates = ARC_FIELD_CANDIDATES[concept];
    for (var i = 0; i < candidates.length; i++) {
      var match = fieldLookup[arc_fieldKey_(candidates[i])];
      if (match) {
        mapping[concept] = match;
        break;
      }
    }
  });
  mapping._domains = domains;
  return mapping;
}

function arc_fetchJson_(url, options) {
  var response = arc_fetch_(url, options || {});
  if (response.code < 200 || response.code >= 300) {
    throw new Error('HTTP ' + response.code + ' fetching ' + url);
  }
  if (response.contentType && response.contentType.indexOf('json') === -1 && response.text && response.text.charAt(0) !== '{' && response.text.charAt(0) !== '[') {
    throw new Error('Expected JSON from ' + url + ' but got ' + response.contentType);
  }
  var parsed = cattle_parseJsonSafe_(response.text, null);
  if (parsed === null) throw new Error('Malformed JSON from ' + url);
  if (parsed.error) throw new Error('ArcGIS error from ' + url + ': ' + (parsed.error.message || JSON.stringify(parsed.error)));
  return parsed;
}

function arc_fetch_(url, options) {
  options = options || {};
  arc_assertPublicUrl_(url);
  var cacheKey = 'arc:' + cattle_hashString_(url);
  var cacheSeconds = options.cacheSeconds || 0;
  if (cacheSeconds > 0) {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (cacheReadErr) {
        Logger.log('Ignored malformed ArcGIS script cache entry.');
      }
    }
  }
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true,
    timeoutSeconds: CATTLEOS.EXTERNAL_FETCH_TIMEOUT_SECONDS
  });
  var code = response.getResponseCode();
  var headers = response.getAllHeaders ? response.getAllHeaders() : {};
  var contentType = String(headers['Content-Type'] || headers['content-type'] || '');
  var text = response.getContentText();
  var payload = {
    code: code,
    contentType: contentType,
    text: text,
    url: url,
    fetchedAt: cattle_nowIso_()
  };
  try {
    nws_storeRawCache_(url, code, text);
  } catch (err) {
    Logger.log('Raw cache write failed: ' + err.message);
  }
  if (cacheSeconds > 0 && code >= 200 && code < 300) {
    var serialized = JSON.stringify(payload);
    if (serialized.length <= CATTLEOS.MAX_SCRIPT_CACHE_CHARS) {
      try {
        CacheService.getScriptCache().put(cacheKey, serialized, cacheSeconds);
      } catch (cacheErr) {
        Logger.log('ArcGIS script cache write skipped: ' + cacheErr.message);
      }
    }
  }
  return payload;
}

function arc_esriFeatureSetToGeoJson_(featureSet) {
  var features = featureSet && featureSet.features ? featureSet.features : [];
  return {
    type: 'FeatureCollection',
    exceededTransferLimit: !!(featureSet && featureSet.exceededTransferLimit),
    features: features.map(function(feature) {
      return {
        type: 'Feature',
        properties: feature.attributes || {},
        geometry: risk_esriGeometryToGeoJson(feature.geometry)
      };
    })
  };
}

function arc_findWebMapIds_(object) {
  var ids = {};
  function walk(value, key) {
    if (value == null) return;
    if (typeof value === 'string' && /web.?map|map.?item|itemid/i.test(String(key || '')) && /^[a-f0-9]{32}$/i.test(value)) {
      ids[value] = true;
    }
    if (Array.isArray(value)) {
      value.forEach(function(child) { walk(child, key); });
    } else if (typeof value === 'object') {
      Object.keys(value).forEach(function(childKey) {
        walk(value[childKey], childKey);
      });
    }
  }
  walk(object, '');
  return Object.keys(ids);
}

function arc_flattenOperationalLayers_(layers, source) {
  var out = [];
  (layers || []).forEach(function(layer) {
    var normalized = {
      id: layer.id || '',
      itemId: layer.itemId || '',
      layerId: layer.layerId !== undefined ? layer.layerId : '',
      title: layer.title || layer.name || '',
      url: arc_layerUrl_(layer),
      source: source || '',
      visibility: layer.visibility,
      layerType: layer.layerType || '',
      definitionExpression: layer.layerDefinition && layer.layerDefinition.definitionExpression
        ? layer.layerDefinition.definitionExpression
        : (layer.definitionExpression || ''),
      raw: layer
    };
    if (normalized.url || normalized.itemId || normalized.title) out.push(normalized);
    if (layer.layers && layer.layers.length) {
      out = out.concat(arc_flattenOperationalLayers_(layer.layers, source));
    }
    if (layer.featureCollection && layer.featureCollection.layers) {
      out = out.concat(arc_flattenOperationalLayers_(layer.featureCollection.layers, source));
    }
  });
  return out;
}

function arc_layerUrl_(layer) {
  if (!layer) return '';
  if (layer.url) {
    var url = arc_stripTrailingSlash_(layer.url);
    if (layer.layerId !== undefined && !/\/\d+$/.test(url)) return url + '/' + layer.layerId;
    return url;
  }
  return '';
}

function arc_identifyLayerRole_(layer) {
  var text = [layer.title, layer.url, layer.id, layer.layerType].join(' ').toLowerCase();
  if (/wild|fly/.test(text)) return 'wild-fly-detection';
  if (/case|confirm|detection|animal/.test(text)) return 'confirmed-case';
  if (/infested|surveillance|adjacent|zone|quarantine|nws/.test(text)) return 'zone';
  if (/county|counties/.test(text)) return 'county-boundary';
  return 'unknown';
}

function arc_findMappedValue_(attributes, mapping, concept) {
  var field = mapping && mapping[concept];
  if (field && Object.prototype.hasOwnProperty.call(attributes, field)) {
    return arc_decodeDomainValue_(attributes[field], mapping, field);
  }
  var candidates = ARC_FIELD_CANDIDATES[concept] || [];
  var lowered = {};
  Object.keys(attributes || {}).forEach(function(key) {
    lowered[arc_fieldKey_(key)] = attributes[key];
  });
  for (var i = 0; i < candidates.length; i++) {
    var candidate = arc_fieldKey_(candidates[i]);
    if (Object.prototype.hasOwnProperty.call(lowered, candidate)) return lowered[candidate];
  }
  return '';
}

function arc_decodeDomainValue_(value, mapping, field) {
  var domain = mapping && mapping._domains ? mapping._domains[field] : null;
  return domain && Object.prototype.hasOwnProperty.call(domain, String(value))
    ? domain[String(value)]
    : value;
}

function arc_findObjectId_(attributes, index) {
  var lowered = {};
  Object.keys(attributes || {}).forEach(function(key) {
    lowered[key.toLowerCase()] = attributes[key];
  });
  return lowered.objectid || lowered.object_id || lowered.fid || lowered.globalid || String(index + 1);
}

function arc_fieldKey_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function arc_encodeParams_(params) {
  return Object.keys(params).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
}

function arc_stripTrailingSlash_(url) {
  return String(url || '').replace(/\/+$/, '');
}

function arc_assertPublicUrl_(url) {
  var value = String(url || '');
  if (!/^https:\/\/(?:[a-z0-9-]+\.)*arcgis\.com(?::\d+)?(?:\/|$)/i.test(value)) {
    throw new Error('ArcGIS adapter refused a non-ArcGIS or non-HTTPS URL.');
  }
}
