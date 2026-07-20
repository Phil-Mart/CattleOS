function nws_refreshOfficialData() {
  var health = cattle_withDocumentLock_('REFRESH_OFFICIAL_DATA', nws_refreshOfficialDataUnlocked_);
  try {
    nws_refreshDashboard();
  } catch (dashboardErr) {
    audit_log('WARN', 'POST_REFRESH_DASHBOARD_FAILED', 'Official data refreshed, but the dashboard could not be updated.', {
      error: dashboardErr.message
    });
  }
  return health;
}

function nws_refreshOfficialDataUnlocked_() {
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

  try {
    nws_resolveConfiguredZipForRefresh_();
  } catch (locationErr) {
    audit_log('WARN', 'PRE_REFRESH_LOCATION_FAILED', 'Official data will refresh, but the configured ZIP could not be resolved.', {
      error: locationErr.message
    });
  }

  var tahcResult;
  var usdaResult;
  try {
    tahcResult = nws_refreshTahcArcGis_();
  } catch (err) {
    tahcResult = { ok: false, error: err.message };
    var hasTahcSnapshot = nws_getStoredZones_().some(function(row) {
      return row.Source === 'Texas Animal Health Commission';
    });
    audit_log('ERROR', 'TAHC_REFRESH_FAILED', 'TAHC official data refresh failed.', { error: err.message, stack: err.stack });
    nws_setDataStatus_('tahc-arcgis', 'Texas Animal Health Commission ArcGIS map', CATTLEOS.TAHC_MAP_URL, 'Failed', {
      errorCode: 'TAHC_REFRESH_FAILED',
      errorMessage: err.message,
      usingLastKnownGood: hasTahcSnapshot,
      dataMode: hasTahcSnapshot ? 'Last Known Good' : ''
    });
    if (hasTahcSnapshot) nws_useLastKnownGood('Texas Animal Health Commission');
  }

  try {
    usdaResult = nws_refreshUsda_();
  } catch (err2) {
    usdaResult = { ok: false, error: err2.message };
    var hasUsdaSnapshot = nws_getStoredCases_().some(function(row) {
      return row.Source === 'USDA APHIS';
    });
    audit_log('WARN', 'USDA_REFRESH_FAILED', 'USDA confirmed-detections adapter failed.', { error: err2.message, stack: err2.stack });
    nws_setDataStatus_('usda-confirmed-cases', 'USDA APHIS confirmed detections', CATTLEOS.USDA_CASES_URL, 'Degraded', {
      errorCode: 'USDA_REFRESH_FAILED',
      errorMessage: err2.message,
      usingLastKnownGood: hasUsdaSnapshot,
      dataMode: hasUsdaSnapshot ? 'Last Known Good' : ''
    });
    if (hasUsdaSnapshot) nws_useLastKnownGood('USDA APHIS', ['NWS_Official_Cases']);
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
}

function nws_refreshOfficialDataManual() {
  var health = nws_refreshOfficialData();
  cattle_uiAlert_('Official Data Refresh', nws_describeDataHealth_(health));
  return health;
}

function nws_resolveConfiguredZipForRefresh_() {
  var location = loc_getRanchLocation();
  var point = risk_normalizePoint_(location);
  var zip = loc_validateZip(settings_get('Ranch_ZIP', ''));
  var hasLocationIdentity = cattle_normalizeText_(location.state) &&
    cattle_normalizeText_(location.county);
  if (point.valid && hasLocationIdentity) return location;
  if (!zip.valid) return location;
  return loc_updateFromZip(zip.zip);
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
  if (!settings_getBool('NWS_Enable_Live_Data', true)) {
    return {
      state: 'Unavailable',
      lastSuccess: settings_get('NWS_Last_Successful_Refresh', ''),
      description: 'Unavailable — live official-data refresh is disabled; verify status directly with TAHC before moving animals',
      usingLastKnownGood: false
    };
  }
  var statuses = cattle_sheetRowsForCurrentMode_('NWS_Data_Status');
  var tahc = statuses.filter(function(row) { return row.Source_Key === 'tahc-arcgis'; })[0];
  var lastSuccess = settings_get('NWS_Last_Successful_Refresh', '') || (tahc ? tahc.Last_Success : '');
  var warnHours = Math.max(1, settings_getNumber('NWS_Warn_Stale_Hours', 12));
  var hardHours = Math.max(warnHours, settings_getNumber('NWS_Hard_Stale_Hours', 48));
  var ageHours = nws_ageHours_(lastSuccess);
  var officialStatuses = statuses.filter(function(row) {
    return row.Source_Key === 'tahc-arcgis' || row.Source_Key === 'usda-confirmed-cases';
  });
  var usingLastKnownGood = officialStatuses.some(function(row) {
    return cattle_toBool_(row.Using_Last_Known_Good, false);
  });
  var degradedAdapter = officialStatuses.some(function(row) {
    return ['Failed', 'Degraded'].indexOf(String(row.Adapter_Status)) !== -1 &&
      !nws_isExpectedUsdaLinkFallback_(row);
  });
  var usingUsdaLinkFallback = officialStatuses.some(nws_isExpectedUsdaLinkFallback_);
  var hasZoneSnapshot = nws_getStoredZones_().some(function(zone) {
    var type = risk_normalizeZoneType_(zone.Zone_Type);
    return risk_zoneIsActive_(zone) &&
      type !== 'Unknown' &&
      (!!risk_featureGeometry_(zone) || !!cattle_normalizeText_(zone.County_Names));
  });

  if (!lastSuccess || ageHours === null || ageHours > hardHours || !hasZoneSnapshot) {
    return {
      state: 'Unavailable',
      lastSuccess: lastSuccess || '',
      description: 'Unavailable — verify status directly with TAHC before moving animals',
      usingLastKnownGood: usingLastKnownGood
    };
  }
  if (ageHours > warnHours || degradedAdapter || usingLastKnownGood) {
    return {
      state: 'Delayed',
      lastSuccess: lastSuccess,
      description: usingLastKnownGood
        ? 'Delayed — live refresh failed or data are older than the warning threshold; showing last successful data from ' + lastSuccess
        : 'Delayed — one official adapter is degraded; verify the linked official sources for the latest details',
      usingLastKnownGood: usingLastKnownGood
    };
  }
  return {
    state: 'Current',
    lastSuccess: lastSuccess,
    description: usingUsdaLinkFallback
      ? 'Current Texas zone data — refreshed ' + nws_formatAge_(ageHours) + ' ago; USDA confirmed detections remain available through the official dashboard link'
      : 'Current — refreshed ' + nws_formatAge_(ageHours) + ' ago',
    usingLastKnownGood: false
  };
}

function nws_isExpectedUsdaLinkFallback_(status) {
  status = status || {};
  return status.Source_Key === 'usda-confirmed-cases' &&
    status.Adapter_Status === 'Degraded' &&
    status.Error_Code === 'USDA_DASHBOARD_LINK_ONLY' &&
    !cattle_toBool_(status.Using_Last_Known_Good, false);
}

function nws_useLastKnownGood(source, optionalSheetNames) {
  (optionalSheetNames || ['NWS_Official_Zones', 'NWS_Official_Cases']).forEach(function(sheetName) {
    var sheet = cattle_getSheet_(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var map = cattle_getHeaderMap_(sheet);
    var dataModeColumn = map.Data_Mode;
    if (!dataModeColumn) return;
    var sourceValues = map.Source
      ? sheet.getRange(2, map.Source, sheet.getLastRow() - 1, 1).getValues()
      : [];
    var values = sheet.getRange(2, dataModeColumn, sheet.getLastRow() - 1, 1).getValues().map(function(row, index) {
      var mode = String(row[0] || '');
      if (source && String((sourceValues[index] || [])[0] || '') !== source) return [mode];
      return [mode === 'Live' ? 'Last Known Good' : mode];
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
    endpoints: endpoints,
    tableauCsvUrl: nws_extractUsdaTableauCsvUrl_(response.text)
  };
}

function nws_fetchUsdaCases() {
  var metadata = nws_fetchUsdaDashboardMetadata();
  var tableauError = '';
  if (metadata.tableauCsvUrl) {
    try {
      var csvResponse = nws_fetchUrl_(metadata.tableauCsvUrl);
      if (csvResponse.code < 200 || csvResponse.code >= 300) {
        throw new Error('HTTP ' + csvResponse.code + ' fetching USDA Tableau CSV export');
      }
      var tableauCases = nws_parseUsdaTableauCsv_(csvResponse.text);
      if (tableauCases.length) {
        return {
          ok: true,
          cases: tableauCases,
          method: 'official-tableau-csv',
          endpointCount: 1
        };
      }
      tableauError = 'The USDA Tableau CSV export contained no case rows.';
    } catch (tableauErr) {
      tableauError = tableauErr.message;
      audit_log('WARN', 'USDA_TABLEAU_CSV_FAILED', 'The USDA Tableau CSV export could not be loaded.', {
        endpoint: metadata.tableauCsvUrl,
        error: tableauErr.message
      });
    }
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
          Raw_Attributes_JSON: nws_jsonForCell_(item.raw_attributes)
        };
      }));
    } catch (err) {
      audit_log('WARN', 'USDA_ENDPOINT_QUERY_FAILED', 'A discovered USDA endpoint could not be queried.', { endpoint: endpoint, error: err.message });
    }
  });
  return {
    ok: cases.length > 0,
    cases: cases,
    method: cases.length ? 'structured-public-endpoint' : 'dashboard-link-only',
    endpointCount: metadata.endpoints.length,
    message: cases.length
      ? ''
      : (tableauError || 'No stable structured USDA endpoint was discovered from the public dashboard page.')
  };
}

function nws_extractUsdaTableauCsvUrl_(html) {
  var text = String(html || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x3A;/gi, ':')
    .replace(/&#58;/g, ':');
  var match = text.match(/https:\/\/publicdashboards\.dl\.usda\.gov\/t\/MRP_PUB\/views\/[A-Za-z0-9_.%~-]+\/[A-Za-z0-9_.%~-]+(?:\?[^"'<>\\\s]*)?/i);
  if (!match) return '';
  var base = match[0].split('?')[0].replace(/\/+$/, '');
  var csvUrl = base + '.csv?:showVizHome=no';
  try {
    nws_assertOfficialUrl_(csvUrl);
    return csvUrl;
  } catch (err) {
    return '';
  }
}

function nws_parseUsdaTableauCsv_(csvText) {
  return nws_usdaTableRowsToCases_(Utilities.parseCsv(String(csvText || '')));
}

function nws_usdaTableRowsToCases_(table, optionalCentroidResolver) {
  if (!Array.isArray(table) || table.length < 2) return [];
  var headerIndex = {};
  (table[0] || []).forEach(function(header, index) {
    headerIndex[nws_usdaHeaderKey_(header)] = index;
  });
  ['animalid', 'confirmeddate', 'county', 'state', 'status'].forEach(function(required) {
    if (!Object.prototype.hasOwnProperty.call(headerIndex, required)) {
      throw new Error('USDA Tableau CSV is missing required column: ' + required);
    }
  });
  var centroidResolver = optionalCentroidResolver || nws_geocodeCountyCentroid_;
  var centroidCache = {};
  var fetchedAt = cattle_nowIso_();
  return table.slice(1).map(function(values) {
    function value(header) {
      var index = headerIndex[nws_usdaHeaderKey_(header)];
      return index === undefined ? '' : cattle_normalizeText_(values[index]);
    }
    var officialId = value('Animal ID');
    var county = value('County');
    var state = value('State');
    var confirmedDate = value('Confirmed Date');
    if (!officialId && !county && !confirmedDate) return null;
    var centroidKey = (county + '|' + state).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(centroidCache, centroidKey)) {
      centroidCache[centroidKey] = centroidResolver(county, state) || null;
    }
    var centroid = centroidCache[centroidKey];
    var raw = {};
    (table[0] || []).forEach(function(header, index) {
      raw[String(header)] = values[index] === undefined ? '' : values[index];
    });
    raw.source_method = 'USDA public Tableau CSV export';
    raw.coordinate_precision = centroid
      ? 'Approximate county centroid; USDA does not publish premises coordinates in this export'
      : 'County only; coordinates unavailable';
    var caseType = [value('Case Type'), value('Animal Type')].join(' ');
    return {
      Case_Record_ID: 'USDA:' + cattle_hashString_([officialId, confirmedDate, county, state].join('|')),
      Source: 'USDA APHIS',
      Official_Case_ID: officialId,
      Detection_Type: /fly/i.test(caseType) ? 'Confirmed Wild-Fly Detection' : 'Confirmed Animal Case',
      State: state,
      County: county,
      Animal_Type: value('Animal Type'),
      Species: value('Species'),
      Confirmation_Date: confirmedDate,
      Case_Status: value('Status'),
      Latitude: centroid ? centroid.lat : '',
      Longitude: centroid ? centroid.lng : '',
      Source_URL: CATTLEOS.USDA_CASES_URL,
      Source_Last_Modified: '',
      Fetched_At: fetchedAt,
      Data_Mode: 'Live',
      Raw_Attributes_JSON: nws_jsonForCell_(raw)
    };
  }).filter(function(row) {
    return !!row;
  });
}

function nws_usdaHeaderKey_(value) {
  return cattle_normalizeText_(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function nws_geocodeCountyCentroid_(county, state) {
  var normalizedCounty = cattle_normalizeText_(county);
  var normalizedState = cattle_normalizeText_(state);
  if (!normalizedCounty || !normalizedState) return null;
  var query = normalizedCounty + (/county$/i.test(normalizedCounty) ? '' : ' County') +
    ', ' + normalizedState + ', USA';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'usda-county-centroid:' + cattle_hashString_(query.toLowerCase());
  try {
    var cached = cache.get(cacheKey);
    if (cached) return cattle_parseJsonSafe_(cached, null);
  } catch (cacheReadErr) {
    Logger.log('USDA county-centroid cache read skipped: ' + cacheReadErr.message);
  }
  var response = Maps.newGeocoder().setRegion('US').geocode(query);
  var first = response && response.results && response.results.length ? response.results[0] : null;
  var geometry = first && first.geometry ? first.geometry.location : null;
  var point = risk_normalizePoint_(geometry ? { latitude: geometry.lat, longitude: geometry.lng } : null);
  if (!point.valid) return null;
  var result = { lat: point.lat, lng: point.lng };
  try {
    cache.put(cacheKey, JSON.stringify(result), 21600);
  } catch (cacheWriteErr) {
    Logger.log('USDA county-centroid cache write skipped: ' + cacheWriteErr.message);
  }
  return result;
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
  var modifiedDate = metadata && metadata.modified ? new Date(metadata.modified) : null;
  var sourceLastModified = modifiedDate && !isNaN(modifiedDate.getTime()) ? modifiedDate.toISOString() : '';
  var layers = arc_resolveOperationalLayers(CATTLEOS.TAHC_ARCGIS_ITEM_ID);
  var targetLayers = nws_selectTahcTargetLayers_(layers);
  if (!targetLayers.length) {
    throw new Error('No public queryable TAHC operational layers were discovered. Use the official map link.');
  }
  var zones = [];
  var cases = [];
  var errors = [];
  var zoneErrors = [];
  var caseErrors = [];
  var caseLayerSuccesses = 0;
  targetLayers.forEach(function(layer) {
    try {
      var serviceMetadata = arc_getServiceMetadata(layer.url);
      var featureCollection = arc_queryLayerGeoJson(layer.url, {
        where: layer.definitionExpression || '1=1',
        outFields: '*',
        returnGeometry: true,
        geometryPrecision: CATTLEOS.ARCGIS_GEOMETRY_PRECISION,
        maxAllowableOffset: CATTLEOS.ARCGIS_GEOMETRY_MAX_OFFSET_DEGREES
      });
      var sampleAttrs = featureCollection.features && featureCollection.features[0] ? featureCollection.features[0].properties || {} : {};
      var mapping = arc_buildFieldMapping_(serviceMetadata, sampleAttrs);
      var normalized = arc_normalizeFeatures(featureCollection, mapping);
      if (layer.role === 'zone') {
        var unusableZoneCount = 0;
        var oversizedGeometryCount = 0;
        var layerZones = [];
        normalized.forEach(function(item) {
          var inferredType = item.zone_type !== 'Unknown'
            ? item.zone_type
            : nws_inferZoneTypeFromLayerTitle_(layer.title);
          var geometryPartition = nws_partitionGeometryForCells_(item.geometry);
          if (geometryPartition.truncated) oversizedGeometryCount++;
          var hasStoredGeometry = geometryPartition.parts.some(function(part) {
            return !!part.serialized.text;
          });
          var usable = inferredType !== 'Unknown' &&
            (hasStoredGeometry || !!cattle_normalizeText_(item.county));
          if (!usable) {
            unusableZoneCount++;
            return;
          }
          var storableParts = geometryPartition.parts.filter(function(part) {
            return !!part.serialized.text;
          });
          if (!storableParts.length) storableParts = geometryPartition.parts.slice(0, 1);
          storableParts.forEach(function(part, partIndex) {
            var partKey = storableParts.length > 1 ? ':part:' + (partIndex + 1) : '';
            layerZones.push({
              Zone_Record_ID: 'TAHC:' + cattle_hashString_(
                layer.url + ':' + (layer.definitionExpression || '') + ':' + item.source_feature_id + partKey
              ),
              Source: 'Texas Animal Health Commission',
              Source_Feature_ID: item.source_feature_id,
              Zone_Name: typeof item.zone_name === 'string' && item.zone_name
                ? item.zone_name
                : (layer.title || ''),
              Zone_Type: inferredType,
              County_Names: item.county || '',
              State: 'TX',
              Effective_Date: item.effective_date || '',
              End_Date: '',
              Official_Status: item.case_status || '',
              Geometry_Type: part.serialized.text && part.geometry ? part.geometry.type : '',
              Geometry_GeoJSON: part.serialized.text,
              Source_URL: CATTLEOS.TAHC_MAP_URL,
              Source_Item_ID: CATTLEOS.TAHC_ARCGIS_ITEM_ID,
              Source_Layer_URL: layer.url,
              Source_Last_Modified: sourceLastModified,
              Fetched_At: refreshedAt,
              Data_Mode: 'Live',
              Raw_Attributes_JSON: nws_jsonForCell_(item.raw_attributes)
            });
          });
        });
        zones = zones.concat(layerZones);
        if (unusableZoneCount) {
          var unusableError = {
            layer: layer.title || layer.url,
            error: unusableZoneCount + ' zone record(s) lacked a reliable zone type and usable geometry/county mapping.'
          };
          errors.push(unusableError);
          zoneErrors.push(unusableError);
        }
        if (oversizedGeometryCount) {
          errors.push({
            layer: layer.title || layer.url,
            error: oversizedGeometryCount + ' geometry value(s) exceeded the Google Sheets cell limit and were evaluated conservatively at county level when possible.'
          });
        }
      } else {
        caseLayerSuccesses++;
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
            Raw_Attributes_JSON: nws_jsonForCell_(item.raw_attributes)
          };
        }));
      }
    } catch (err) {
      var layerError = { layer: layer.title || layer.url, error: err.message };
      errors.push(layerError);
      if (layer.role === 'zone') zoneErrors.push(layerError);
      else caseErrors.push(layerError);
      audit_log('WARN', 'TAHC_LAYER_FAILED', 'A discovered TAHC layer could not be safely loaded.', {
        layer: layer.title || layer.url,
        error: err.message
      });
    }
  });
  if (!zones.length || zoneErrors.length) {
    throw new Error('TAHC zone refresh was incomplete, so the prior snapshot was preserved. Errors: ' + JSON.stringify((zoneErrors.length ? zoneErrors : errors).slice(0, 5)));
  }
  nws_replaceRowsBySource_('NWS_Official_Zones', 'Texas Animal Health Commission', zones);
  var hasStoredTahcCases = nws_getStoredCases_().some(function(row) {
    return row.Source === 'Texas Animal Health Commission';
  });
  var usingCaseLastKnownGood = false;
  if (caseLayerSuccesses > 0 && !caseErrors.length) {
    nws_replaceRowsBySource_('NWS_Official_Cases', 'Texas Animal Health Commission', cases);
  } else if (hasStoredTahcCases) {
    nws_useLastKnownGood('Texas Animal Health Commission', ['NWS_Official_Cases']);
    usingCaseLastKnownGood = true;
    if (!caseLayerSuccesses) {
      errors.push({
        layer: 'TAHC case layers',
        error: 'No current case layer was available; preserved prior TAHC detections as last known good.'
      });
    }
  }
  nws_setDataStatus_('tahc-arcgis', 'Texas Animal Health Commission ArcGIS map', CATTLEOS.TAHC_MAP_URL, errors.length ? 'Degraded' : 'OK', {
    lastSuccess: refreshedAt,
    sourceLastModified: sourceLastModified,
    recordsReceived: zones.length + (caseErrors.length ? 0 : cases.length),
    errorMessage: errors.length ? JSON.stringify(errors.slice(0, 5)) : '',
    usingLastKnownGood: usingCaseLastKnownGood,
    dataMode: usingCaseLastKnownGood ? 'Mixed Live / Last Known Good' : 'Live',
    schemaFingerprint: cattle_hashString_(JSON.stringify(targetLayers.map(function(layer) {
      return {
        title: layer.title,
        url: layer.url,
        role: layer.role,
        definitionExpression: layer.definitionExpression || ''
      };
    })))
  });
  return {
    ok: true,
    refreshedAt: refreshedAt,
    sourceLastModified: sourceLastModified,
    zones: zones.length,
    cases: caseErrors.length ? 0 : cases.length,
    usingCaseLastKnownGood: usingCaseLastKnownGood,
    errors: errors
  };
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
  var hasLastKnownGood = nws_getStoredCases_().some(function(row) {
    return row.Source === 'USDA APHIS';
  });
  nws_setDataStatus_('usda-confirmed-cases', 'USDA APHIS confirmed detections', CATTLEOS.USDA_CASES_URL, 'Degraded', {
    errorCode: 'USDA_DASHBOARD_LINK_ONLY',
    errorMessage: result.message || 'USDA structured public endpoint not available.',
    usingLastKnownGood: hasLastKnownGood,
    dataMode: hasLastKnownGood ? 'Last Known Good' : ''
  });
  if (hasLastKnownGood) nws_useLastKnownGood('USDA APHIS', ['NWS_Official_Cases']);
  return result;
}

function nws_setDataStatus_(sourceKey, sourceName, sourceUrl, adapterStatus, details) {
  details = details || {};
  var existing = cattle_sheetRowsAsObjects_('NWS_Data_Status').filter(function(row) {
    return row.Source_Key === sourceKey;
  })[0] || {};
  function detail(name, fallback) {
    return Object.prototype.hasOwnProperty.call(details, name) ? details[name] : fallback;
  }
  var now = cattle_nowIso_();
  var usingLastKnownGood = detail('usingLastKnownGood', false);
  cattle_upsertByKey_('NWS_Data_Status', 'Source_Key', sourceKey, {
    Source_Key: sourceKey,
    Source_Name: sourceName,
    Source_URL: sourceUrl,
    Adapter_Status: adapterStatus,
    Last_Attempt: now,
    Last_Success: detail('lastSuccess', adapterStatus === 'OK' ? now : (existing.Last_Success || '')),
    Source_Last_Modified: detail('sourceLastModified', existing.Source_Last_Modified || ''),
    Records_Received: detail('recordsReceived', existing.Records_Received || 0),
    Error_Code: detail('errorCode', ''),
    Error_Message: detail('errorMessage', ''),
    Using_Last_Known_Good: usingLastKnownGood ? 'TRUE' : 'FALSE',
    Data_Mode: detail('dataMode', usingLastKnownGood ? 'Last Known Good' : (existing.Data_Mode || (adapterStatus === 'OK' ? 'Live' : ''))),
    Schema_Fingerprint: detail('schemaFingerprint', existing.Schema_Fingerprint || '')
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
      Payload_Text: String(payloadText || '').slice(0, CATTLEOS.MAX_CACHE_PAYLOAD_CHARS)
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
  return cattle_sheetRowsForCurrentMode_('NWS_Official_Zones').filter(function(row) {
    return row.Zone_Record_ID;
  });
}

function nws_getStoredCases_() {
  return cattle_sheetRowsForCurrentMode_('NWS_Official_Cases').filter(function(row) {
    return row.Case_Record_ID;
  });
}

function nws_replaceRowsBySource_(sheetName, source, rows) {
  var sheet = cattle_ensureHeaders_(sheetName);
  var existing = cattle_sheetRowsAsObjects_(sheetName);
  var keep = existing.filter(function(row) { return row.Source !== source; });
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var allRows = keep.concat(rows || []);
  if (nws_rowsEquivalent_(headers, existing, allRows)) return false;
  var requiredRows = allRows.length + 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  var clearRows = Math.max(sheet.getLastRow() - 1, allRows.length);
  if (clearRows > 0) sheet.getRange(2, 1, clearRows, sheet.getLastColumn()).clearContent();
  if (allRows.length) {
    sheet.getRange(2, 1, allRows.length, headers.length).setValues(allRows.map(function(object) {
      return headers.map(function(header) {
        return cattle_safeCellValue_(
          Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ''
        );
      });
    }));
  }
  return true;
}

function nws_rowsEquivalent_(headers, leftRows, rightRows) {
  var stableHeaders = (headers || []).filter(function(header) {
    return header && header !== 'Fetched_At';
  });
  function normalize(rows) {
    return (rows || []).map(function(row) {
      var values = stableHeaders.map(function(header) {
        var value = Object.prototype.hasOwnProperty.call(row, header) ? row[header] : '';
        if (header === 'Geometry_GeoJSON' && value) {
          var geometry = nws_parseGeometryCell_(value);
          return geometry ? cattle_json_(geometry) : value;
        }
        return Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value;
      });
      return JSON.stringify(values);
    }).sort();
  }
  return JSON.stringify(normalize(leftRows)) === JSON.stringify(normalize(rightRows));
}

function nws_normalizeDetectionType_(type) {
  var text = cattle_normalizeText_(type).toLowerCase();
  if (text.indexOf('fly') !== -1) return 'Confirmed Wild-Fly Detection';
  if (text.indexOf('animal') !== -1 || text.indexOf('case') !== -1) return 'Confirmed Animal Case';
  return 'Other Confirmed Detection';
}

function nws_inferZoneTypeFromLayerTitle_(title) {
  var text = cattle_normalizeText_(title).toLowerCase();
  var infested = /infested|quarantine/.test(text);
  var surveillance = /adjacent|surveillance/.test(text);
  if (infested === surveillance) return 'Unknown';
  return infested ? 'Infested Zone' : 'Surveillance Zone';
}

function nws_selectTahcTargetLayers_(layers) {
  var targetLayers = (layers || []).filter(function(layer) {
    return ['zone', 'confirmed-case', 'wild-fly-detection'].indexOf(layer.role) !== -1 && layer.url;
  });
  if (targetLayers.length > 12) {
    throw new Error('TAHC map exposed more than 12 relevant layers; refusing to evaluate a silently truncated snapshot.');
  }
  return targetLayers;
}

function nws_serializeGeometry_(geometry) {
  if (!geometry) return { text: '', truncated: false };
  var normalized = nws_roundGeometry_(geometry, CATTLEOS.ARCGIS_GEOMETRY_PRECISION);
  var text = cattle_json_(normalized) || '';
  if (text.length <= CATTLEOS.MAX_GEOMETRY_CELL_CHARS) {
    return { text: text, truncated: false, encoding: 'json' };
  }
  try {
    var compressed = CATTLEOS.GEOMETRY_GZIP_PREFIX + Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(text, 'application/json')).getBytes()
    );
    if (compressed.length <= CATTLEOS.MAX_GEOMETRY_CELL_CHARS) {
      return { text: compressed, truncated: false, encoding: 'gzip-base64' };
    }
  } catch (compressionErr) {
    Logger.log('Geometry compression failed: ' + compressionErr.message);
  }
  return { text: '', truncated: true };
}

function nws_partitionGeometryForCells_(geometry, optionalSerializer) {
  var serializer = optionalSerializer || nws_serializeGeometry_;
  var serialized = serializer(geometry);
  var original = {
    geometry: geometry,
    serialized: serialized
  };
  if (!serialized.truncated || !geometry || geometry.type !== 'MultiPolygon' ||
      !Array.isArray(geometry.coordinates) || !geometry.coordinates.length) {
    return { parts: [original], partitioned: false, truncated: !!serialized.truncated };
  }
  var parts = geometry.coordinates.map(function(coordinates) {
    var polygon = { type: 'Polygon', coordinates: coordinates };
    return {
      geometry: polygon,
      serialized: serializer(polygon)
    };
  });
  if (parts.some(function(part) { return !part.serialized.text || part.serialized.truncated; })) {
    return { parts: [original], partitioned: false, truncated: true };
  }
  return { parts: parts, partitioned: true, truncated: false };
}

function nws_parseGeometryCell_(value) {
  var text = String(value || '');
  if (!text) return null;
  if (text.indexOf(CATTLEOS.GEOMETRY_GZIP_PREFIX) !== 0) {
    return cattle_parseJsonSafe_(text, null);
  }
  try {
    var encoded = text.slice(CATTLEOS.GEOMETRY_GZIP_PREFIX.length);
    var blob = Utilities.newBlob(Utilities.base64Decode(encoded), 'application/gzip');
    var decoded = Utilities.ungzip(blob).getDataAsString('UTF-8');
    return cattle_parseJsonSafe_(decoded, null);
  } catch (err) {
    Logger.log('Stored geometry could not be decompressed: ' + err.message);
    return null;
  }
}

function nws_roundGeometry_(geometry, precision) {
  if (!geometry || !geometry.type) return geometry;
  var places = Math.max(0, Number(precision) || 0);
  function roundCoordinates(value) {
    if (Array.isArray(value)) return value.map(roundCoordinates);
    return typeof value === 'number' && isFinite(value)
      ? Number(value.toFixed(places))
      : value;
  }
  var rounded = {};
  Object.keys(geometry).forEach(function(key) {
    rounded[key] = key === 'coordinates' ? roundCoordinates(geometry[key]) : geometry[key];
  });
  return rounded;
}

function nws_jsonForCell_(value) {
  var text = cattle_json_(value);
  if (text === undefined) return '';
  if (text.length <= CATTLEOS.MAX_CACHE_PAYLOAD_CHARS) return text;
  return cattle_json_({
    truncated: true,
    content_hash: cattle_hashString_(text),
    preview: text.slice(0, CATTLEOS.MAX_CACHE_PAYLOAD_CHARS - 160)
  });
}

function nws_fetchUrl_(url) {
  nws_assertOfficialUrl_(url);
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
  var text = String(html || '')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  var regexes = [
    /https:\/\/[^"'\\\s]+\/(?:FeatureServer|MapServer)\/\d+/g,
    /https:\/\/services[^"'\\\s]+\/(?:FeatureServer|MapServer)\/\d+/g
  ];
  regexes.forEach(function(regex) {
    var match;
    while ((match = regex.exec(text)) !== null) {
      var endpoint = match[0].replace(/[),.;]+$/, '');
      try {
        arc_assertPublicUrl_(endpoint);
        endpoints[endpoint] = true;
      } catch (err) {
        Logger.log('Ignored non-ArcGIS endpoint discovered in USDA page.');
      }
    }
  });
  return Object.keys(endpoints).sort();
}

function nws_ageHours_(iso) {
  if (!iso) return null;
  var date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return Math.max(0, (new Date().getTime() - date.getTime()) / 36e5);
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

function nws_assertOfficialUrl_(url) {
  var value = String(url || '');
  var isAphisPage = /^https:\/\/www\.aphis\.usda\.gov(?:\/|$)/i.test(value);
  var isTableauCsv = /^https:\/\/publicdashboards\.dl\.usda\.gov\/t\/MRP_PUB\/views\/[A-Za-z0-9_.%~-]+\/[A-Za-z0-9_.%~-]+\.csv(?:\?|$)/i.test(value);
  if (isAphisPage || isTableauCsv) return;
  throw new Error('USDA adapter refused a non-approved or non-HTTPS URL.');
}
