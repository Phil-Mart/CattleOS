function test_runAll() {
  var results = [];
  [
    test_zipHandling_,
    test_geometry_,
    test_riskEngine_,
    test_arcgisAdapter_,
    test_gptValidation_,
    test_coreSafety_
  ].forEach(function(testFn) {
    results = results.concat(testFn());
  });
  try {
    results = results.concat(test_runIntegrationSmokeTest());
  } catch (err) {
    results.push(test_result_(false, 'Workbook integration smoke test', err.message));
  }
  test_logResults_(results);
  var failed = results.filter(function(row) { return !row.pass; });
  if (failed.length) {
    cattle_uiAlert_('CattleOS Tests', failed.length + ' test(s) failed. See Audit_Log for details.');
    throw new Error(failed.length + ' CattleOS test(s) failed.');
  }
  cattle_uiAlert_('CattleOS Tests', 'All ' + results.length + ' tests passed.');
  return results;
}

function test_runPureUnitTests() {
  var results = []
    .concat(test_zipHandling_())
    .concat(test_geometry_())
    .concat(test_riskEngine_())
    .concat(test_arcgisAdapter_())
    .concat(test_gptValidation_())
    .concat(test_coreSafety_());
  var failed = results.filter(function(row) { return !row.pass; });
  if (failed.length) throw new Error(failed.map(function(row) { return row.name + ': ' + row.message; }).join('\n'));
  return results;
}

function test_runIntegrationSmokeTest() {
  var results = [];
  setup_initializeWorkbook({ showOnboarding: false, reason: 'integration smoke test' });
  results.push(test_assert_('Dashboard sheet exists', !!cattle_getSheet_('Dashboard')));
  results.push(test_assert_('NWS_Watch sheet exists', !!cattle_getSheet_('NWS_Watch')));
  results.push(test_assert_('Settings sheet exists', !!cattle_getSheet_('Settings')));
  results.push(test_assert_('RANCH_ZIP_INPUT named range exists', !!cattle_getSpreadsheet_().getRangeByName('RANCH_ZIP_INPUT')));
  results.push(test_assert_('Ranch_ZIP setting exists', settings_findRow_('Ranch_ZIP') > 0));
  results.push(test_assert_('NWS hidden zones sheet exists', !!cattle_getSheet_('NWS_Official_Zones')));
  var before = settings_get('Schema_Version');
  migration_runV11({ showOnboarding: false });
  results.push(test_assert_('Migration keeps schema version 1.1', settings_get('Schema_Version') === CATTLEOS.VERSION));
  results.push(test_assert_('Migration did not blank schema version', before === '' || settings_get('Schema_Version') === CATTLEOS.VERSION));
  test_logResults_(results);
  return results;
}

function test_zipHandling_() {
  var results = [];
  results.push(test_assert_('ZIP 78026 valid', loc_validateZip('78026').valid));
  results.push(test_assert_('Leading-zero ZIP preserved as string', loc_validateZip('02108').zip === '02108'));
  results.push(test_assert_('Whitespace trimmed', loc_validateZip(' 78026 ').zip === '78026'));
  results.push(test_assert_('Numeric 2108 pads to 02108', loc_validateZip(2108).zip === '02108'));
  results.push(test_assert_('Four-digit string rejected', !loc_validateZip('2108').valid));
  results.push(test_assert_('Six-digit ZIP rejected', !loc_validateZip('123456').valid));
  results.push(test_assert_('ZIP+4 rejected', !loc_validateZip('78026-1234').valid));
  results.push(test_assert_('Letters rejected', !loc_validateZip('ABCDE').valid));
  results.push(test_assert_('Blank ZIP rejected', !loc_validateZip('').valid));
  results.push(test_assert_('Blank exact coordinates are optional', !loc_validateExactCoordinates_('', '').provided));
  var exact = loc_validateExactCoordinates_(0, 0);
  results.push(test_assert_('Zero-valued exact coordinates remain valid', exact.provided && exact.latitude === 0 && exact.longitude === 0));
  results.push(test_assert_('Partial exact coordinates are rejected', test_throws_(function() {
    loc_validateExactCoordinates_('28.9', '');
  })));
  results.push(test_assert_('Out-of-range exact coordinates are rejected', test_throws_(function() {
    loc_validateExactCoordinates_('91', '-98');
  })));
  var geocoded = loc_geocodeZip('02108', test_geocoderFixture_('02108', 'Boston', 'Suffolk County', 'MA', 42.358, -71.064));
  results.push(test_assert_('Geocoder parses city', geocoded.city === 'Boston'));
  results.push(test_assert_('Geocoder parses county', geocoded.county === 'Suffolk County'));
  results.push(test_assert_('Geocoder labels ZIP centroid', geocoded.location_source === 'ZIP Centroid'));
  var texas = loc_geocodeZip('78026', test_geocoderFixture_('78026', 'Jourdanton', 'Atascosa County', 'TX', 28.92, -98.54));
  results.push(test_assert_('Texas ZIP parses TX state', texas.state === 'TX'));
  var missingCounty = loc_geocodeZip('78026', test_geocoderFixture_('78026', 'Jourdanton', '', 'TX', 28.92, -98.54));
  results.push(test_assert_('County can be blank without guessing', missingCounty.county === ''));
  return results;
}

function test_geometry_() {
  var results = [];
  var polygon = { type: 'Polygon', coordinates: [[[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]]] };
  var hole = { type: 'Polygon', coordinates: [[[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]], [[-98.7, 28.3], [-98.3, 28.3], [-98.3, 28.7], [-98.7, 28.7], [-98.7, 28.3]]] };
  var multi = { type: 'MultiPolygon', coordinates: [
    [[[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]]],
    [[[-97, 27], [-96, 27], [-96, 28], [-97, 28], [-97, 27]]]
  ] };
  results.push(test_assert_('Point inside polygon', risk_pointInPolygon({ latitude: 28.5, longitude: -98.5 }, polygon)));
  results.push(test_assert_('Point outside polygon', !risk_pointInPolygon({ latitude: 29.5, longitude: -98.5 }, polygon)));
  results.push(test_assert_('Point on edge counts inside', risk_pointInPolygon({ latitude: 28.5, longitude: -99 }, polygon)));
  results.push(test_assert_('Point on vertex counts inside', risk_pointInPolygon({ latitude: 28, longitude: -99 }, polygon)));
  results.push(test_assert_('Unclosed polygon closing edge counts as boundary', risk_pointOnBoundary({ latitude: 28.5, longitude: -99 }, [[-99, 28], [-98, 28], [-98, 29], [-99, 29]])));
  results.push(test_assert_('Point in polygon hole is outside', !risk_pointInPolygon({ latitude: 28.5, longitude: -98.5 }, hole)));
  results.push(test_assert_('Point in multipolygon', risk_pointInMultiPolygon({ latitude: 27.5, longitude: -96.5 }, multi)));
  results.push(test_assert_('Lat/lng reversal detection', !risk_pointInPolygon([28.5, -98.5], polygon)));
  results.push(test_assert_('Invalid geometry returns false', !risk_pointInPolygon({ latitude: 28, longitude: -98 }, null)));
  results.push(test_assert_('Blank point coordinates are invalid', !risk_normalizePoint_({ latitude: '', longitude: '' }).valid));
  results.push(test_assert_('Empty feature distance returns null', risk_minDistanceToFeatures({ latitude: 28, longitude: -98 }, []) === null));
  var esri = risk_esriGeometryToGeoJson({ rings: [[[-99, 28], [-98, 28], [-98, 29], [-99, 29]]] });
  results.push(test_assert_('Esri polygon converts to GeoJSON polygon', esri.type === 'Polygon' && esri.coordinates[0][0][0] === -99));
  var esriWithHole = risk_esriGeometryToGeoJson({ rings: [
    [[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]],
    [[-98.7, 28.3], [-98.3, 28.3], [-98.3, 28.7], [-98.7, 28.7], [-98.7, 28.3]]
  ] });
  results.push(test_assert_('Esri polygon conversion groups holes', esriWithHole.type === 'Polygon' && esriWithHole.coordinates.length === 2 && !risk_pointInPolygon({ latitude: 28.5, longitude: -98.5 }, esriWithHole)));
  var esriMulti = risk_esriGeometryToGeoJson({ rings: [
    [[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]],
    [[-97, 27], [-96, 27], [-96, 28], [-97, 28], [-97, 27]]
  ] });
  results.push(test_assert_('Disjoint Esri rings convert to MultiPolygon', esriMulti.type === 'MultiPolygon' && risk_pointInMultiPolygon({ latitude: 27.5, longitude: -96.5 }, esriMulti)));
  var segmentDistance = risk_minDistanceToFeatures({ latitude: 28.5, longitude: -98.5 }, [{
    geometry: { type: 'LineString', coordinates: [[-99, 28], [-98, 28]] }
  }]);
  results.push(test_assert_('Feature distance uses line segments, not only vertices', segmentDistance > 30 && segmentDistance < 40));
  return results;
}

function test_riskEngine_() {
  var results = [];
  var baseLocation = {
    zip: '78026',
    city: 'Jourdanton',
    county: 'Atascosa County',
    state: 'TX',
    latitude: 28.5,
    longitude: -98.5,
    location_source: 'ZIP Centroid',
    location_precision: 'Approximate',
    resolved_at: cattle_nowIso_()
  };
  var infested = {
    Zone_Record_ID: 'Z1',
    Zone_Name: 'Fixture Infested',
    Zone_Type: 'Infested Zone',
    County_Names: 'Atascosa County',
    Geometry_GeoJSON: JSON.stringify({ type: 'Polygon', coordinates: [[[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]]] })
  };
  var surveillance = {
    Zone_Record_ID: 'Z2',
    Zone_Name: 'Fixture Surveillance',
    Zone_Type: 'Surveillance Zone',
    County_Names: 'Atascosa County',
    Geometry_GeoJSON: JSON.stringify({ type: 'Polygon', coordinates: [[[-99.5, 27.5], [-97.5, 27.5], [-97.5, 29.5], [-99.5, 29.5], [-99.5, 27.5]]] })
  };
  var healthCurrent = { state: 'Current', lastSuccess: cattle_nowIso_() };
  var inside = risk_evaluateRanchNwsStatus(baseLocation, [infested], [], healthCurrent);
  results.push(test_assert_('Inside infested is critical', inside.official_zone_status === 'Inside Mapped Infested Zone' && inside.operational_attention === 'Critical'));
  var outsidePoint = Object.assign({}, baseLocation, { latitude: 29.4, longitude: -98.5 });
  var partial = risk_evaluateRanchNwsStatus(outsidePoint, [infested], [], healthCurrent);
  results.push(test_assert_('Partial-county outside polygon is uncertain heightened', partial.official_zone_status === 'Affected County — Exact Position Uncertain' && partial.operational_attention === 'Heightened'));
  var countyOnly = Object.assign({}, infested, { Geometry_GeoJSON: '' });
  var countyResult = risk_evaluateRanchNwsStatus(baseLocation, [countyOnly], [], healthCurrent);
  results.push(test_assert_('Affected county missing geometry is critical uncertain', countyResult.official_zone_status === 'Affected County — Exact Position Uncertain' && countyResult.operational_attention === 'Critical'));
  var surveillanceResult = risk_evaluateRanchNwsStatus(baseLocation, [surveillance], [], healthCurrent);
  results.push(test_assert_('Inside surveillance is heightened', surveillanceResult.official_zone_status === 'Inside Mapped Surveillance Zone' && surveillanceResult.operational_attention === 'Heightened'));
  var near = risk_evaluateRanchNwsStatus(Object.assign({}, baseLocation, { latitude: 27.5, longitude: -97.5 }), [], [{ Case_Record_ID: 'C1', Latitude: 27.6, Longitude: -97.6, County: 'Fixture County' }], healthCurrent);
  results.push(test_assert_('Nearby detection raises attention', near.operational_attention === 'Heightened'));
  var delayed = risk_evaluateRanchNwsStatus(Object.assign({}, baseLocation, { latitude: 27.5, longitude: -97.5 }), [], [], { state: 'Delayed', lastSuccess: cattle_daysAgoIso_(1) });
  results.push(test_assert_('Delayed data raises attention', delayed.operational_attention === 'Heightened'));
  var stale = risk_evaluateRanchNwsStatus(baseLocation, [], [], { state: 'Unavailable', lastSuccess: '' });
  results.push(test_assert_('Unavailable data returns Data Unavailable', stale.operational_attention === 'Data Unavailable'));
  var nonTexas = risk_evaluateRanchNwsStatus(Object.assign({}, baseLocation, { state: 'MA' }), [], [], healthCurrent);
  results.push(test_assert_('Non-Texas location separates state logic', nonTexas.official_zone_status === 'Non-Texas Location'));
  var missingState = risk_evaluateRanchNwsStatus(Object.assign({}, baseLocation, { state: '' }), [infested], [], healthCurrent);
  results.push(test_assert_('Missing resolved state stays unavailable', missingState.official_zone_status === 'Unknown' && missingState.operational_attention === 'Data Unavailable'));
  var missingCounty = risk_evaluateRanchNwsStatus(Object.assign({}, baseLocation, { county: '' }), [infested], [], healthCurrent);
  results.push(test_assert_('Missing resolved county stays unavailable', missingCounty.official_zone_status === 'Unknown' && missingCounty.operational_attention === 'Data Unavailable'));
  var noZip = risk_evaluateRanchNwsStatus({}, [], [], healthCurrent);
  results.push(test_assert_('No ZIP unknown', noZip.official_zone_status === 'Unknown'));
  var exactWithoutZip = risk_evaluateRanchNwsStatus(
    Object.assign({}, baseLocation, { zip: '', location_source: 'Exact Coordinates' }),
    [infested],
    [],
    healthCurrent
  );
  results.push(test_assert_(
    'Exact coordinates cannot bypass required ZIP validation',
    exactWithoutZip.official_zone_status === 'Unknown' &&
      exactWithoutZip.operational_attention === 'Data Unavailable'
  ));
  var unclassified = Object.assign({}, infested, { Zone_Type: 'Unknown' });
  var unclassifiedResult = risk_evaluateRanchNwsStatus(baseLocation, [unclassified], [], healthCurrent);
  results.push(test_assert_(
    'Containing zone with unknown type stays unavailable',
    unclassifiedResult.official_zone_status === 'Unknown' &&
      unclassifiedResult.operational_attention === 'Data Unavailable'
  ));
  var demo = risk_evaluateRanchNwsStatus(baseLocation, [], [], { state: 'Demo', lastSuccess: cattle_nowIso_() });
  results.push(test_assert_('Demo mode labels data health', demo.official_data_health === 'Demo'));
  var inactive = Object.assign({}, infested, { Official_Status: 'Inactive' });
  var inactiveResult = risk_evaluateRanchNwsStatus(baseLocation, [inactive], [], healthCurrent);
  results.push(test_assert_('Inactive official zones do not trigger current status', inactiveResult.official_zone_status === 'Outside Currently Mapped Texas Zone'));
  return results;
}

function test_arcgisAdapter_() {
  var results = [];
  results.push(test_assert_(
    'Instant Apps values.webmap reference is discovered',
    arc_findWebMapIds_({ values: { webmap: '6e489e665b1943c3a3a79aa83605e843' } })[0] === '6e489e665b1943c3a3a79aa83605e843'
  ));
  var mapping = arc_buildFieldMapping_({
    fields: [
      { name: 'ZONECATEGORY', alias: 'Zone Type' },
      { name: 'CountyName', alias: 'County Name' },
      { name: 'StartDate', alias: 'Effective Date' }
    ]
  }, {});
  results.push(test_assert_('ArcGIS aliases map zone type', mapping.zone_type === 'ZONECATEGORY'));
  results.push(test_assert_('ArcGIS aliases map county', mapping.county === 'CountyName'));
  var domainMapping = arc_buildFieldMapping_({
    fields: [{
      name: 'zone_name',
      alias: 'Zone name',
      domain: {
        codedValues: [
          { code: 1, name: 'Infested Zone' },
          { code: 2, name: 'Adjacent Surveillance Zone' }
        ]
      }
    }]
  }, { zone_name: 1 });
  results.push(test_assert_('TAHC zone_name field maps to zone type', domainMapping.zone_type === 'zone_name'));
  results.push(test_assert_('ArcGIS coded zone values decode to official names', arc_decodeDomainValue_(1, domainMapping, 'zone_name') === 'Infested Zone'));
  var filteredLayers = arc_flattenOperationalLayers_([
    {
      title: 'Surveillance',
      url: 'https://services1.arcgis.com/example/FeatureServer/33',
      layerDefinition: { definitionExpression: 'zone_name = 2' }
    },
    {
      title: 'Infested',
      url: 'https://services1.arcgis.com/example/FeatureServer/33',
      layerDefinition: { definitionExpression: 'zone_name = 1' }
    }
  ], 'fixture');
  results.push(test_assert_(
    'Operational layer filters remain distinct',
    filteredLayers.length === 2 &&
      filteredLayers[0].definitionExpression !== filteredLayers[1].definitionExpression
  ));
  var featureSet = {
    features: [{
      attributes: { OBJECTID: 1, ZONECATEGORY: 'Infested', CountyName: 'Fixture County', StartDate: '2026-07-18' },
      geometry: { rings: [[[-99, 28], [-98, 28], [-98, 29], [-99, 29], [-99, 28]]] }
    }]
  };
  var geojson = arc_esriFeatureSetToGeoJson_(featureSet);
  var normalized = arc_normalizeFeatures(geojson, mapping);
  results.push(test_assert_('Esri JSON fallback converts features', geojson.type === 'FeatureCollection' && geojson.features.length === 1));
  results.push(test_assert_('Normalized ArcGIS feature stores raw attributes', normalized[0].raw_attributes.CountyName === 'Fixture County'));
  results.push(test_assert_('Field aliases changing still normalize zone', normalized[0].zone_type === 'Infested Zone'));
  results.push(test_assert_('HTTP 403 fixture can be represented safely', test_httpErrorFixture_(403).code === 403));
  results.push(test_assert_('Malformed JSON fixture is rejected by parser', cattle_parseJsonSafe_('{bad', null) === null));
  results.push(test_assert_('Empty layer fixture normalizes empty list', arc_normalizeFeatures({ type: 'FeatureCollection', features: [] }, {}).length === 0));
  var html = '<script>const url="https://services.arcgis.com/example/ArcGIS/rest/services/NWS/FeatureServer/0";</script>';
  results.push(test_assert_('USDA endpoint discovery fixture finds FeatureServer layer', nws_extractStructuredEndpoints_(html).length === 1));
  var tableauHtml = '<iframe src="https://publicdashboards.dl.usda.gov/t/MRP_PUB/views/NewWorldScrewwormPublicReporting_17805168329840/SummaryDashboard?%3Aembed=y&amp;%3AshowVizHome=no"></iframe>';
  var tableauUrl = nws_extractUsdaTableauCsvUrl_(tableauHtml);
  results.push(test_assert_(
    'USDA Tableau iframe resolves to the approved CSV export',
    tableauUrl === 'https://publicdashboards.dl.usda.gov/t/MRP_PUB/views/NewWorldScrewwormPublicReporting_17805168329840/SummaryDashboard.csv?:showVizHome=no'
  ));
  results.push(test_assert_('Non-USDA Tableau hosts are ignored', nws_extractUsdaTableauCsvUrl_(
    '<iframe src="https://example.com/t/MRP_PUB/views/workbook/view"></iframe>'
  ) === ''));
  results.push(test_assert_('Approved USDA Tableau CSV URL passes host validation', !test_throws_(function() {
    nws_assertOfficialUrl_(tableauUrl);
  })));
  var centroidCalls = 0;
  var usdaCases = nws_usdaTableRowsToCases_([
    ['Animal ID', 'Animal Type', 'Case Type', 'Confirmed Date', 'County', 'Species', 'State', 'Status'],
    ['TX-1', 'Domestic', 'Domestic', '7/18/2026', 'Starr', 'Cattle', 'Texas', 'Active'],
    ['TX-2', 'Fly Trap', 'Fly Trap', '7/19/2026', 'Starr', '', 'Texas', 'Active']
  ], function() {
    centroidCalls++;
    return { lat: 26.56, lng: -98.74 };
  });
  results.push(test_assert_('USDA Tableau rows normalize into official case records', usdaCases.length === 2 && usdaCases[0].Official_Case_ID === 'TX-1'));
  results.push(test_assert_('USDA county centroid is resolved once per county', centroidCalls === 1));
  results.push(test_assert_('USDA fly-trap rows remain distinct from animal cases', usdaCases[1].Detection_Type === 'Confirmed Wild-Fly Detection'));
  results.push(test_assert_('USDA case records retain county-centroid precision metadata', cattle_parseJsonSafe_(
    usdaCases[0].Raw_Attributes_JSON, {}
  ).coordinate_precision.indexOf('Approximate county centroid') === 0));
  results.push(test_assert_('Combined zone layer title is not used as an ambiguous fallback', nws_inferZoneTypeFromLayerTitle_('Infested and Surveillance Zones') === 'Unknown'));
  results.push(test_assert_('Expected USDA dashboard fallback does not stale Texas zone data', nws_isExpectedUsdaLinkFallback_({
    Source_Key: 'usda-confirmed-cases',
    Adapter_Status: 'Degraded',
    Error_Code: 'USDA_DASHBOARD_LINK_ONLY',
    Using_Last_Known_Good: 'FALSE'
  })));
  results.push(test_assert_('Unexpected USDA adapter failures remain degraded', !nws_isExpectedUsdaLinkFallback_({
    Source_Key: 'usda-confirmed-cases',
    Adapter_Status: 'Degraded',
    Error_Code: 'USDA_REFRESH_FAILED',
    Using_Last_Known_Good: 'FALSE'
  })));
  var tooManyLayers = [];
  for (var layerIndex = 0; layerIndex < 13; layerIndex++) {
    tooManyLayers.push({
      role: 'zone',
      url: 'https://services1.arcgis.com/example/FeatureServer/' + layerIndex
    });
  }
  results.push(test_assert_('TAHC layer selection refuses silent truncation', test_throws_(function() {
    nws_selectTahcTargetLayers_(tooManyLayers);
  })));
  results.push(test_assert_('Non-ArcGIS URLs are rejected by ArcGIS adapter', test_throws_(function() {
    arc_assertPublicUrl_('https://example.com/FeatureServer/0');
  })));
  return results;
}

function test_gptValidation_() {
  var results = [];
  var allowed = ['SYSTEM:RISK', 'SYSTEM:DATA_HEALTH', 'H1'];
  var valid = {
    headline: 'Brief',
    risk_summary: 'Data unavailable where missing.',
    urgent_actions: [{ priority: 'High', action: 'Review open wound.', reason: 'Open wound record.', source_record_ids: ['H1'] }],
    animals_to_review: [{ animal_id: 'A1', reason: 'Open wound.', source_record_ids: ['H1'] }],
    inspection_plan: [{ scope: 'Whole Herd', due: '2026-07-19', reason: 'Cadence.' }],
    financial_watchlist: [],
    data_quality_issues: [],
    questions_for_owner: [],
    safety_note: CATTLEOS.SAFETY_NOTICE
  };
  results.push(test_assert_('Valid GPT output passes', brief_validateOutput(valid, allowed, []).valid));
  var missing = Object.assign({}, valid);
  delete missing.headline;
  results.push(test_assert_('Missing field rejected', !brief_validateOutput(missing, allowed, []).valid));
  var invalidPriority = JSON.parse(JSON.stringify(valid));
  invalidPriority.urgent_actions[0].priority = 'Urgent';
  results.push(test_assert_('Invalid priority rejected', !brief_validateOutput(invalidPriority, allowed, []).valid));
  var invented = JSON.parse(JSON.stringify(valid));
  invented.urgent_actions[0].source_record_ids = ['MADE_UP'];
  results.push(test_assert_('Invented source ID rejected', !brief_validateOutput(invented, allowed, []).valid));
  var treatment = JSON.parse(JSON.stringify(valid));
  treatment.urgent_actions[0].action = 'Administer 10 ml medicine.';
  results.push(test_assert_('Treatment or dosage rejected', !brief_validateOutput(treatment, allowed, []).valid));
  var confirmedSuspect = JSON.parse(JSON.stringify(valid));
  confirmedSuspect.urgent_actions[0].reason = 'Confirmed case from suspected record.';
  results.push(test_assert_('Confirmation claim from suspected record rejected', !brief_validateOutput(confirmedSuspect, allowed, ['H1']).valid));
  var diagnosedSuspect = JSON.parse(JSON.stringify(valid));
  diagnosedSuspect.urgent_actions[0].reason = 'Diagnosed screwworm from suspected record.';
  results.push(test_assert_('Diagnosis claim from suspected record rejected', !brief_validateOutput(diagnosedSuspect, allowed, ['H1']).valid));
  var unconfirmedSuspect = JSON.parse(JSON.stringify(valid));
  unconfirmedSuspect.urgent_actions[0].reason = 'Suspected observation, not confirmed.';
  results.push(test_assert_('Explicitly unconfirmed suspected record wording remains valid', brief_validateOutput(unconfirmedSuspect, allowed, ['H1']).valid));
  results.push(test_assert_('Suspected-data warning says ZIP is withheld by default', brief_suspectedSharingNotice_({
    location_summary: { county: 'Atascosa County', state: 'TX' }
  }).indexOf('ZIP is withheld.') !== -1));
  results.push(test_assert_('Suspected-data warning discloses enabled ZIP sharing', brief_suspectedSharingNotice_({
    location_summary: { county: 'Atascosa County', state: 'TX', zip: '78026' }
  }).indexOf('ZIP is included because ZIP sharing is enabled.') !== -1));
  results.push(test_assert_('Malformed JSON rejected', !brief_validateOutput('{bad', allowed, []).valid));
  var wrongArrayType = JSON.parse(JSON.stringify(valid));
  wrongArrayType.urgent_actions = 'not-an-array';
  results.push(test_assert_('Wrong array type is rejected without throwing', !brief_validateOutput(wrongArrayType, allowed, []).valid));
  var unexpected = JSON.parse(JSON.stringify(valid));
  unexpected.unexpected = true;
  results.push(test_assert_('Unexpected structured-output field rejected', !brief_validateOutput(unexpected, allowed, []).valid));
  var noCitation = JSON.parse(JSON.stringify(valid));
  noCitation.urgent_actions[0].source_record_ids = [];
  results.push(test_assert_('Urgent action without source citation rejected', !brief_validateOutput(noCitation, allowed, []).valid));
  var responseText = openai_extractResponseText_({
    output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }]
  });
  results.push(test_assert_('Responses API output text is not duplicated', responseText === '{"ok":true}'));
  var fallback = brief_generateDeterministicFallback({
    location_summary: { official_zone_status: 'Unknown', operational_attention: 'Data Unavailable', official_data_health: 'Unavailable' },
    open_wound_summary: { records: [], unresolved_count: 0 },
    inspection_summary: { next_recommended_inspection: '2026-07-19' },
    data_quality_issues: ['Fixture issue'],
    allowed_source_record_ids: allowed,
    suspected_source_record_ids: []
  });
  results.push(test_assert_('Deterministic fallback validates', brief_validateOutput(fallback, allowed, []).valid));
  return results;
}

function test_coreSafety_() {
  var results = [];
  var modeAwareSheets = ['Herd', 'Breeding', 'Calves', 'Measurements', 'Health', 'Inspections', 'Expenses', 'Sales_Harvest', 'Feed_Forage', 'Pastures', 'Tasks', 'Alerts', 'Ranch_Brief_Log'];
  results.push(test_assert_('Operational sheets carry explicit demo/live mode columns', modeAwareSheets.every(function(name) {
    return CATTLEOS.HEADERS[name].indexOf('Data_Mode') !== -1;
  })));
  results.push(test_assert_('Formula-like external text is forced to a plain cell value', cattle_safeCellValue_('=IMPORTXML("https://example.com")').charAt(0) === "'"));
  results.push(test_assert_('Numeric cell values are not altered by formula protection', cattle_safeCellValue_(-98.5) === -98.5));
  results.push(test_assert_('Date-only value due today is not overdue', !cattle_isPastDate_(Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'))));
  results.push(test_assert_('Numeric Unix epoch zero remains a valid date', cattle_parseDate_(0).getTime() === 0));
  results.push(test_assert_('Epoch-millisecond strings parse without losing precision', cattle_parseDate_('1721260800000').getTime() === 1721260800000));
  results.push(test_assert_('Critical priority is never relaxed by a lower-priority refresh', nws_moreUrgentPriority_('Critical', 'Normal') === 'Critical'));
  results.push(test_assert_('A newly critical refresh tightens an existing normal priority', nws_moreUrgentPriority_('Normal', 'Critical') === 'Critical'));
  results.push(test_assert_('Resolved suspected events do not enter the review queue', nws_classifyHealthReview_('Screwworm Suspected', 'Unresolved', true) === null));
  results.push(test_assert_('Unresolved suspected events retain critical rank', nws_classifyHealthReview_('Screwworm Suspected', 'Unresolved', false).rank === 1));
  results.push(test_assert_('Animal-level NWS findings are not whole-herd inspections', !nws_isWholeHerdInspection_({ Scope: 'Animal', Findings: 'NWS wound check' })));
  results.push(test_assert_('Whole-herd scope ID is recognized', nws_isWholeHerdInspection_({ Scope_ID: 'WHOLE_HERD' })));
  results.push(test_assert_('Future source timestamps do not produce negative age', nws_ageHours_(new Date(new Date().getTime() + 3600000).toISOString()) === 0));
  results.push(test_assert_('Detection precision is recovered from stored USDA source metadata', risk_detectionCoordinatePrecision_({
    Raw_Attributes_JSON: '{"coordinate_precision":"Approximate county centroid"}'
  }) === 'Approximate county centroid'));
  results.push(test_assert_('Complete demo dependencies pass preflight', contest_missingDemoDependencies_({
    brief_generateMockBrief: true,
    brief_getLatestBriefSummary_: true
  }).length === 0));
  results.push(test_assert_('Missing Ranch Brief helper is named by demo preflight', contest_missingDemoDependencies_({
    brief_generateMockBrief: true,
    brief_getLatestBriefSummary_: false
  })[0] === 'brief_getLatestBriefSummary_'));
  results.push(test_assert_('Dashboard reports an unavailable Ranch Brief module without crashing', nws_getLatestBriefSummarySafe_(null) === 'Ranch Brief unavailable - sync RanchBrief.gs'));
  results.push(test_assert_('Dashboard uses the installed Ranch Brief summary helper', nws_getLatestBriefSummarySafe_(function() {
    return 'Latest fixture brief';
  }) === 'Latest fixture brief'));
  results.push(test_assert_('Ranch Brief records an available actor email', brief_getActorEmail_({
    getActiveUser: function() {
      return { getEmail: function() { return 'owner@example.com'; } };
    }
  }) === 'owner@example.com'));
  results.push(test_assert_('Ranch Brief tolerates unavailable actor-email permission', brief_getActorEmail_({
    getActiveUser: function() {
      throw new Error('userinfo.email permission unavailable');
    }
  }) === ''));
  results.push(test_assert_('Unchanged snapshots ignore fetch timestamp only', nws_rowsEquivalent_(
    ['Zone_Record_ID', 'Fetched_At', 'Data_Mode'],
    [{ Zone_Record_ID: 'Z1', Fetched_At: 'one', Data_Mode: 'Live' }],
    [{ Zone_Record_ID: 'Z1', Fetched_At: 'two', Data_Mode: 'Live' }]
  )));
  results.push(test_assert_('Snapshot comparison detects data-mode changes', !nws_rowsEquivalent_(
    ['Zone_Record_ID', 'Fetched_At', 'Data_Mode'],
    [{ Zone_Record_ID: 'Z1', Fetched_At: 'one', Data_Mode: 'Last Known Good' }],
    [{ Zone_Record_ID: 'Z1', Fetched_At: 'two', Data_Mode: 'Live' }]
  )));
  var largeRing = [];
  for (var i = 0; i < 7000; i++) {
    largeRing.push([-100 + i / 100000, 28 + (i % 17) / 100000]);
  }
  largeRing.push(largeRing[0]);
  var storedGeometry = nws_serializeGeometry_({ type: 'Polygon', coordinates: [largeRing] });
  results.push(test_assert_(
    'Oversized geometry uses gzip storage instead of truncation',
    !storedGeometry.truncated &&
      storedGeometry.text.indexOf(CATTLEOS.GEOMETRY_GZIP_PREFIX) === 0 &&
      storedGeometry.text.length <= CATTLEOS.MAX_GEOMETRY_CELL_CHARS
  ));
  var restoredGeometry = nws_parseGeometryCell_(storedGeometry.text);
  results.push(test_assert_(
    'Compressed geometry round-trips for risk evaluation',
    restoredGeometry && restoredGeometry.type === 'Polygon' && restoredGeometry.coordinates[0].length === largeRing.length
  ));
  var safeJson = cattle_safeJsonForHtml_({ value: '</script><script>alert(1)</script>' });
  results.push(test_assert_('HTML template JSON escapes script-closing text', safeJson.indexOf('</script>') === -1 && safeJson.indexOf('\\u003c') !== -1));
  return results;
}

function test_geocoderFixture_(zip, city, county, state, lat, lng) {
  var components = [
    { long_name: zip, short_name: zip, types: ['postal_code'] },
    { long_name: city, short_name: city, types: ['locality'] },
    { long_name: state === 'TX' ? 'Texas' : state, short_name: state, types: ['administrative_area_level_1'] },
    { long_name: 'United States', short_name: 'US', types: ['country'] }
  ];
  if (county) components.push({ long_name: county, short_name: county, types: ['administrative_area_level_2'] });
  return {
    results: [{
      formatted_address: city + ', ' + state + ' ' + zip + ', USA',
      address_components: components,
      geometry: { location: { lat: lat, lng: lng } }
    }]
  };
}

function test_httpErrorFixture_(code) {
  return { code: code, text: '', contentType: 'application/json' };
}

function test_throws_(callback) {
  try {
    callback();
    return false;
  } catch (err) {
    return true;
  }
}

function test_assert_(name, condition, message) {
  return test_result_(!!condition, name, message || (condition ? 'OK' : 'Assertion failed'));
}

function test_result_(pass, name, message) {
  return { pass: pass, name: name, message: message || '', checkedAt: cattle_nowIso_() };
}

function test_logResults_(results) {
  (results || []).forEach(function(result) {
    audit_log(result.pass ? 'INFO' : 'ERROR', 'TEST_' + (result.pass ? 'PASS' : 'FAIL'), result.name, result);
  });
}
