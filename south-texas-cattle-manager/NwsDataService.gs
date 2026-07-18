function nws_refreshOfficialData() {
  return cattle_withDocumentLock_('REFRESH_OFFICIAL_DATA', function() {
    setup_ensureWorkbookStructure_();
    settings_ensureDefaults();
    var demoMode = settings_getBool('Contest_Demo_Mode', false);
    if (demoMode) {
      settings_set('NWS_Data_Health', 'Demo', { editable: false });
      nws_setDataStatus_('contest-demo', 'Contest demo data', '', 'OK', {
        recordsReceived: nws_getStoredZones_().length + nws_getStoredCases_().length,
        dataMode: 'Demo'
      });
      return nws_getDataHealth();
    }
    if (!settings_getBool('NWS_Enable_Live_Data', true)) {
      nws_setDataStatus_('live-disabled', 'Official NWS live data', '', 'Disabled', {
        errorMessage: 'Live data refresh is disabled in Settings.',
        dataMode: 'Manual Official Override'
      });
      settings_set('NWS_Data_Health', 'Unavailable', { editable: false });
      return nws_getDataHealth();
    }

    var tahcResult;
    var usdaResult;
    try {
      tahcResult = nws_refreshTahcArcGis_();
    } catch (err) {
      tahcResult = { ok: false, error: err.message };
      audit_log('ERROR', 'TAHC_REFRESH_FAILED', 'TAHC official data refresh failed.', { error: err.message, stack: err.stack });
      nws_setDataStatus_('tahc-arcgis', 'Texas Animal Health Commission ArcGIS map', CATTLEOS.TAHC_MAP_URL, 'Failed', {
        errorCode: 'TAHC_REFRESH_FAILED',
        errorMessage: err.message,
        usingLastKnownGood: true
      });
      nws_useLastKnownGood();
    }

    try {
      usdaResult = nws_refreshUsda_();
    } catch (err2) {
      usdaResult = { ok: false, error: err2.message };
      audit_log('WARN', 'USDA_REFRESH_FAILED', 'USDA confirmed-detections adapter failed.', { error: err2.message, stack: err2.stack });
      nws_setDataStatus_('usda-confirmed-cases', 'USDA APHIS confirmed detections', CATTLEOS.USDA_CASES_URL, 'Degraded', {
        errorCode: 'USDA_REFRESH_FAILED',
        errorMessage: err2.message,
        usingLastKnownGood: true
      });
    }

    if (tahcResult && tahcResult.ok) {
      settings_set('NWS_Last_Successful_Refresh', tahcResult.refreshedAt, { editable: false });
      settings_set('NWS_Last_Source_Modified', tahcResult.sourceLastModified || '', { editable: false });
    }
    var health = nws_getDataHealth();
    settings_set('NWS_Data_Health', health.state, { editable: false });
    audit_log('INFO', 'REFRESH_OFFICIAL_DATA', 'Official data refresh completed.', {
      tahc: tahcResult,
      usda: usdaResult,
      health: health
    });
    return health;
  });
}

function nws_refreshOfficialDataManual() {
  var health = nws_refreshOfficialData();
  nws_refreshDashboard();
  cattle_uiAlert_('Official Data Refresh', nws_describeDataHealth_(health));
  return health;
}

function nws_installRefreshTrigger() {
  var requested = Math.max(1, Math.floor(settings_getNumber('NWS_Refresh_Hours', 12)));
  var allowed = [1, 2, 4, 6, 8, 12];
  var hours = allowed.reduce(function(best, value) {
    return Math.abs(value - requested) < Math.abs(best - requested) ? value : best;
  }, 12);
  automation_removeTriggersForHandler_('nws_refreshOfficialData');
  ScriptApp.newTrigger('nws_refreshOfficialData').timeBased().everyHours(hours).create();
  settings_set('NWS_Auto_Refresh', true);
  audit_log('INFO', 'INSTALL_NWS_TRIGGER', 'NWS refresh trigger installed.', { requestedHours: requested, actualHours: hours });
  cattle_showToast_('NWS refresh trigger installed every ' + hours + ' hour(s).');
}

function nws_removeRefreshTriggers() {
  automation_removeTriggersForHandler_('nws_refreshOfficialData');
  audit_log('INFO', 'REMOVE_NWS_TRIGGERS', 'NWS refresh triggers removed.', {});
}

function nws_getDataHealth() {
  if (settings_getBool('Contest_Demo_Mode', false)) {
    return {
      state: 'Demo',
      lastSuccess: settings_get('NWS_Last_Successful_Refresh', ''),
      description: 'Demo — simulated outbreak records for judging and testing',
      usingLastKnownGood: false
    };
  }
  var statuses = cattle_sheetRowsAsObjects_('NWS_Data_Status');
  var tahc = statuses.filter(function(row) { return row.Source_Key === 'tahc-arcgis'; })[0];
  var lastSuccess = settings_get('NWS_Last_Successful_Refresh', '') || (tahc ? tahc.Last_Success : '');
  var warnHours = Math.max(1, settings_getNumber('NWS_Warn_Stale_Hours', 12));
  var hardHours = Math.max(warnHours, settings_getNumber('NWS_Hard_Stale_Hours', 48));
  var ageHours = nws_ageHours_(lastSuccess);
  var usingLastKnownGood = statuses.some(function(row) {
    return cattle_toBool_(row.Using_Last_Known_Good, false);
  });
  var failedRequired = tahc && ['Failed', 'Degraded'].indexOf(String(tahc.Adapter_Status)) !== -1;

  if (!lastSuccess || ageHours === null || ageHours > hardHours) {
    return {
      state: 'Unavailable',
      lastSuccess: lastSuccess || '',
      description: 'Unavailable — verify status directly with TAHC before moving animals',
      usingLastKnownGood: usingLastKnownGood
    };
  }
  if (ageHours > warnHours || failedRequired || usingLastKnownGood) {
    return {
      state: 'Delayed',
      lastSuccess: lastSuccess,
      description: 'Delayed — live refresh failed or data are older than the warning threshold; showing last successful data from ' + lastSuccess,
      usingLastKnownGood: true
    };
  }
  return {
    state: 'Current',
    lastSuccess: lastSuccess,
    description: 'Current — refreshed ' + nws_formatAge_(ageHours) + ' ago',
    usingLastKnownGood: false
  };
}

function nws_useLastKnownGood() {
  ['NWS_Official_Zones', 'NWS_Official_Cases'].forEach(function(sheetName) {
    var sheet = cattle_getSheet_(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var map = cattle_getHeaderMap_(sheet);
    var dataModeColumn = map.Data_Mode;
    if (!dataModeColumn) return;
    var values = sheet.getRange(2, dataModeColumn, sheet.getLastRow() - 1, 1).getValues().map(function(row) {
      var mode = String(row[0] || '');
      return [mode === 'Live' ? 'Last Known Good' : mode || 'Last Known Good'];
    });
    sheet.getRange(2, dataModeColumn, values.length, 1).setValues(values);
  });
  settings_set('NWS_Data_Health', 'Delayed', { editable: false });
}

function nws_fetchUsdaDashboardMetadata() {
  var response = nws_fetchUrl_(CATTLEOS.USDA_CASES_URL);
  if (response.code < 200 || response.code >= 300) throw new Error('HTTP ' + response.code + ' fetching USDA dashboard page');
  var endpoints = nws_extractStructuredEndpoints_(response.text);
  return {
    sourceUrl: CATTLEOS.USDA_CASES_URL,
    fetchedAt: cattle_nowIso_(),
    endpointCount: endpoints.length,
    endpoints: endpoints
  };
}

function nws_fetchUsdaCases() {
  var metadata = nws_fetchUsdaDashboardMetadata();
  if (!metadata.endpoints.length) {
    return {
      ok: false,
      cases: [],
      method: 'dashboard-link-only',
      message: 'No stable structured USDA endpoint was discovered from the public dashboard page.'
    };
  }
  var cases = [];
  metadata.endpoints.slice(0, 3).forEach(function(endpoint) {
    try {
      var queryUrl = endpoint.replace(/\/+$/, '') + '/query';
      var featureCollection = arc_queryLayerGeoJson(queryUrl.replace(/\/query$/, ''), { where: '1=1', outFields: '*', returnGeometry: true });
      var normalized = arc_normalizeFeatures(featureCollection, arc_buildFieldMapping_({}, (featureCollection.features[0] || {}).properties || {}));
      cases = cases.concat(normalized.map(function(item) {
        var point = item.geometry && item.geometry.type === 'Point' ? risk_normalizePoint_(item.geometry.coordinates) : { valid: false };
        return {
          Case_Record_ID: 'USDA:' + cattle_hashString_(endpoint + ':' + item.source_feature_id),
          Source: 'USDA APHIS',
          Official_Case_ID: item.source_feature_id,
          Detection_Type: nws_normalizeDetectionType_(item.detection_type || item.zone_type),
          State: item.raw_attributes.State || item.raw_attributes.state || '',
          County: item.county || item.raw_attributes.County || item.raw_attributes.county || '',
          Animal_Type: item.animal_type || '',
          Species: item.raw_attributes.Species || item.raw_attributes.species || '',
          Confirmation_Date: item.confirmation_date || '',
          Case_Status: item.case_status || '',
          Latitude: point.valid ? point.lat : '',
          Longitude: point.valid ? point.lng : '',
          Source_URL: CATTLEOS.USDA_CASES_URL,
          Source_Last_Modified: '',
          Fetched_At: cattle_nowIso_(),
          Data_Mode: 'Live',
          Raw_Attributes_JSON: cattle_json_(item.raw_attributes)
        };
      }));
    } catch (err) {
      audit_log('WARN', 'USDA_ENDPOINT_QUERY_FAILED', 'A discovered USDA endpoint could not be queried.', { endpoint: endpoint, error: err.message });
    }
  });
  return { ok: cases.length > 0, cases: cases, method: 'structured-public-endpoint', endpointCount: metadata.endpoints.length };
}

function nws_normalizeUsdaCases(rawCases) {
  return (rawCases || []).map(function(row) {
    row.Detection_Type = nws_normalizeDetectionType_(row.Detection_Type);
    row.Data_Mode = row.Data_Mode || 'Live';
    row.Source = row.Source || 'USDA APHIS';
    row.Source_URL = row.Source_URL || CATTLEOS.USDA_CASES_URL;
    row.Fetched_At = row.Fetched_At || cattle_nowIso_();
    return row;
  });
}

function nws_storeUsdaCases(rawCases) {
  var cases = nws_normalizeUsdaCases(rawCases);
  if (!cases.length) return 0;
  nws_replaceRowsBySource_('NWS_Official_Cases', 'USDA APHIS', cases);
  return cases.length;
}

function nws_refreshTahcArcGis_() {
  var refreshedAt = cattle_nowIso_();
  var metadata = arc_getItemMetadata(CATTLEOS.TAHC_ARCGIS_ITEM_ID);
  var sourceLastModified = metadata && metadata.modified ? new Date(metadata.modified).toISOString() : '';
  var layers = arc_resolveOperationalLayers(CATTLEOS.TAHC_ARCGIS_ITEM_ID);
  var targetLayers = layers.filter(function(layer) {
    return ['zone', 'confirmed-case', 'wild-fly-detection'].indexOf(layer.role) !== -1 && layer.url;
  }).slice(0, 12);
  if (!targetLayers.length) {
    throw new Error('No public queryable TAHC operational layers were discovered. Use the official map link.');
  }
  var zones = [];
  var cases = [];
  var errors = [];
  targetLayers.forEach(function(layer) {
    try {
      var serviceMetadata = arc_getServiceMetadata(layer.url);
      var featureCollection = arc_queryLayerGeoJson(layer.url, { where: '1=1', outFields: '*', returnGeometry: true });
      var sampleAttrs = featureCollection.features && featureCollection.features[0] ? featureCollection.features[0].properties || {} : {};
      var mapping = arc_buildFieldMapping_(serviceMetadata, sampleAttrs);
      var normalized = arc_normalizeFeatures(featureCollection, mapping);
      if (layer.role === 'zone') {
        zones = zones.concat(normalized.map(function(item) {
          return {
            Zone_Record_ID: 'TAHC:' + cattle_hashString_(layer.url + ':' + item.source_feature_id),
            Source: 'Texas Animal Health Commission',
            Source_Feature_ID: item.source_feature_id,
            Zone_Name: item.zone_name || layer.title || '',
            Zone_Type: item.zone_type || 'Unknown',
            County_Names: item.county || '',
            State: 'TX',
            Effective_Date: item.effective_date || '',
            End_Date: '',
            Official_Status: item.case_status || '',
            Geometry_Type: item.geometry_type || '',
            Geometry_GeoJSON: item.geometry ? cattle_json_(item.geometry) : '',
            Source_URL: CATTLEOS.TAHC_MAP_URL,
            Source_Item_ID: CATTLEOS.TAHC_ARCGIS_ITEM_ID,
            Source_Layer_URL: layer.url,
            Source_Last_Modified: sourceLastModified,
            Fetched_At: refreshedAt,
            Data_Mode: 'Live',
            Raw_Attributes_JSON: cattle_json_(item.raw_attributes)
          };
        }));
      } else {
        cases = cases.concat(normalized.map(function(item) {
          var point = item.geometry && item.geometry.type === 'Point' ? risk_normalizePoint_(item.geometry.coordinates) : { valid: false };
          return {
            Case_Record_ID: 'TAHC:' + cattle_hashString_(layer.url + ':' + item.source_feature_id),
            Source: 'Texas Animal Health Commission',
            Official_Case_ID: item.source_feature_id,
            Detection_Type: layer.role === 'wild-fly-detection' ? 'Confirmed Wild-Fly Detection' : nws_normalizeDetectionType_(item.detection_type),
            State: 'TX',
            County: item.county || '',
            Animal_Type: item.animal_type || '',
            Species: '',
            Confirmation_Date: item.confirmation_date || '',
            Case_Status: item.case_status || '',
            Latitude: point.valid ? point.lat : '',
            Longitude: point.valid ? point.lng : '',
            Source_URL: CATTLEOS.TAHC_MAP_URL,
            Source_Last_Modified: sourceLastModified,
            Fetched_At: refreshedAt,
            Data_Mode: 'Live',
            Raw_Attributes_JSON: cattle_json_(item.raw_attributes)
          };
        }));
      }
    } catch (err) {
      errors.push({ layer: layer.title || layer.url, error: err.message });
    }
  });
  if (!zones.length && !cases.length) {
    throw new Error('TAHC layers were discovered, but no zone or case records could be normalized. Errors: ' + JSON.stringify(errors));
  }
  if (zones.length) nws_replaceRowsBySource_('NWS_Official_Zones', 'Texas Animal Health Commission', zones);
  if (cases.length) nws_replaceRowsBySource_('NWS_Official_Cases', 'Texas Animal Health Commission', cases);
  nws_setDataStatus_('tahc-arcgis', 'Texas Animal Health Commission ArcGIS map', CATTLEOS.TAHC_MAP_URL, errors.length ? 'Degraded' : 'OK', {
    lastSuccess: refreshedAt,
    sourceLastModified: sourceLastModified,
    recordsReceived: zones.length + cases.length,
    errorMessage: errors.length ? JSON.stringify(errors.slice(0, 5)) : '',
    usingLastKnownGood: false,
    dataMode: 'Live',
    schemaFingerprint: cattle_hashString_(JSON.stringify(targetLayers.map(function(layer) { return { title: layer.title, url: layer.url, role: layer.role }; })))
  });
  return { ok: true, refreshedAt: refreshedAt, sourceLastModified: sourceLastModified, zones: zones.length, cases: cases.length, errors: errors };
}

function nws_refreshUsda_() {
  var result = nws_fetchUsdaCases();
  if (result.ok && result.cases.length) {
    var count = nws_storeUsdaCases(result.cases);
    nws_setDataStatus_('usda-confirmed-cases', 'USDA APHIS confirmed detections', CATTLEOS.USDA_CASES_URL, 'OK', {
      lastSuccess: cattle_nowIso_(),
      recordsReceived: count,
      usingLastKnownGood: false,
      dataMode: 'Live',
      schemaFingerprint: cattle_hashString_(JSON.stringify(result.cases.slice(0, 3).map(function(row) { return Object.keys(row); })))
    });
    return { ok: true, cases: count, method: result.method };
  }
  nws_setDataStatus_('usda-confirmed-cases', 'USDA APHIS confirmed detections', CATTLEOS.USDA_CASES_URL, 'Degraded', {
    errorCode: 'USDA_DASHBOARD_LINK_ONLY',
    errorMessage: result.message || 'USDA structured public endpoint not available.',
    usingLastKnownGood: true,
    dataMode: 'Last Known Good'
  });
  return result;
}

function nws_setDataStatus_(sourceKey, sourceName, sourceUrl, adapterStatus, details) {
  details = details || {};
  cattle_upsertByKey_('NWS_Data_Status', 'Source_Key', sourceKey, {
    Source_Key: sourceKey,
    Source_Name: sourceName,
    Source_URL: sourceUrl,
    Adapter_Status: adapterStatus,
    Last_Attempt: cattle_nowIso_(),
    Last_Success: details.lastSuccess || (adapterStatus === 'OK' ? cattle_nowIso_() : ''),
    Source_Last_Modified: details.sourceLastModified || '',
    Records_Received: details.recordsReceived || 0,
    Error_Code: details.errorCode || '',
    Error_Message: details.errorMessage || '',
    Using_Last_Known_Good: details.usingLastKnownGood ? 'TRUE' : 'FALSE',
    Data_Mode: details.dataMode || (adapterStatus === 'OK' ? 'Live' : ''),
    Schema_Fingerprint: details.schemaFingerprint || ''
  });
}

function nws_storeRawCache_(url, responseCode, payloadText) {
  var sheet = cattle_ensureHeaders_('NWS_Raw_Cache');
  var hash = cattle_hashString_(payloadText || '');
  var cacheKey = cattle_hashString_(url + ':' + hash);
  var existing = cattle_sheetRowsAsObjects_('NWS_Raw_Cache').filter(function(row) {
    return row.Cache_Key === cacheKey;
  });
  if (!existing.length) {
    cattle_appendObject_('NWS_Raw_Cache', {
      Cache_Key: cacheKey,
      Source_URL: url,
      Fetched_At: cattle_nowIso_(),
      Response_Code: responseCode,
      Content_Hash: hash,
      Payload_Text: String(payloadText || '').slice(0, 50000)
    });
  }
  nws_trimRawCache_();
}

function nws_trimRawCache_() {
  var sheet = cattle_getSheet_('NWS_Raw_Cache');
  if (!sheet || sheet.getLastRow() <= CATTLEOS.RAW_CACHE_LIMIT + 1) return;
  var removeCount = sheet.getLastRow() - (CATTLEOS.RAW_CACHE_LIMIT + 1);
  sheet.deleteRows(2, removeCount);
}

function nws_getStoredZones_() {
  return cattle_sheetRowsAsObjects_('NWS_Official_Zones').filter(function(row) {
    return row.Zone_Record_ID;
  });
}

function nws_getStoredCases_() {
  return cattle_sheetRowsAsObjects_('NWS_Official_Cases').filter(function(row) {
    return row.Case_Record_ID;
  });
}

function nws_replaceRowsBySource_(sheetName, source, rows) {
  var sheet = cattle_ensureHeaders_(sheetName);
  var existing = cattle_sheetRowsAsObjects_(sheetName);
  var keep = existing.filter(function(row) { return row.Source !== source; });
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), sheet.getLastColumn()).clearContent();
  var allRows = keep.concat(rows || []);
  if (allRows.length) {
    sheet.getRange(2, 1, allRows.length, headers.length).setValues(allRows.map(function(object) {
      return headers.map(function(header) {
        return Object.prototype.hasOwnProperty.call(object, header) ? object[header] : '';
      });
    }));
  }
}

function nws_normalizeDetectionType_(type) {
  var text = cattle_normalizeText_(type).toLowerCase();
  if (text.indexOf('fly') !== -1) return 'Confirmed Wild-Fly Detection';
  if (text.indexOf('animal') !== -1 || text.indexOf('case') !== -1) return 'Confirmed Animal Case';
  return 'Other Confirmed Detection';
}

function nws_fetchUrl_(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  });
  var headers = response.getAllHeaders ? response.getAllHeaders() : {};
  var payload = {
    code: response.getResponseCode(),
    contentType: String(headers['Content-Type'] || headers['content-type'] || ''),
    text: response.getContentText(),
    fetchedAt: cattle_nowIso_()
  };
  nws_storeRawCache_(url, payload.code, payload.text);
  return payload;
}

function nws_extractStructuredEndpoints_(html) {
  var endpoints = {};
  var text = String(html || '');
  var regexes = [
    /https:\/\/[^"'\\\s]+\/(?:FeatureServer|MapServer)\/\d+/g,
    /https:\/\/services[^"'\\\s]+\/(?:FeatureServer|MapServer)\/\d+/g
  ];
  regexes.forEach(function(regex) {
    var match;
    while ((match = regex.exec(text)) !== null) {
      endpoints[match[0].replace(/\\u002F/g, '/')] = true;
    }
  });
  return Object.keys(endpoints);
}

function nws_ageHours_(iso) {
  if (!iso) return null;
  var date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return (new Date().getTime() - date.getTime()) / 36e5;
}

function nws_formatAge_(hours) {
  if (hours === null) return 'unknown time';
  if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' minutes';
  if (hours < 48) return Math.round(hours) + ' hours';
  return Math.round(hours / 24) + ' days';
}

function nws_describeDataHealth_(health) {
  health = health || nws_getDataHealth();
  return health.description || (health.state + (health.lastSuccess ? ' — last successful refresh ' + health.lastSuccess : ''));
}
