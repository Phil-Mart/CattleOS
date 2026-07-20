function contest_loadDemoData() {
  return contest_loadNwsDemoScenario();
}

function contest_loadNwsDemoScenario() {
  contest_assertDemoDependencies_();
  return cattle_withDocumentLock_('LOAD_NWS_DEMO', function() {
    setup_ensureWorkbookStructure_();
    settings_ensureDefaults();
    nws_buildWatchSheet();
    nws_buildMainDashboard();
    setup_populateHelpSheet_();
    setup_protectSystemSheets_();
    setup_orderSheets_();
    contest_clearNwsDemoScenario(true);
    contest_storePreDemoSettings_();
    settings_set('Contest_Demo_Mode', true);
    settings_set('OpenAI_Mock_Mode', true);
    settings_set('NWS_Data_Health', 'Demo', { editable: false });
    settings_set('Ranch_Name', 'DEMO CattleOS Ranch');
    settings_set('Acres', '425');
    loc_saveRanchLocation({
      zip: '78026',
      city: 'Jourdanton',
      county: 'Atascosa County',
      state: 'TX',
      latitude: 28.92,
      longitude: -98.54,
      location_source: 'ZIP Centroid',
      location_precision: 'Approximate',
      resolved_at: cattle_nowIso_()
    });
    contest_seedOfficialDemo_();
    contest_seedHerdDemo_();
    contest_seedWorkflowDemo_();
    settings_set('NWS_Last_Successful_Refresh', cattle_nowIso_(), { editable: false });
    nws_setDataStatus_('contest-demo', 'Contest demo data', '', 'OK', {
      lastSuccess: cattle_nowIso_(),
      recordsReceived: 3,
      dataMode: 'Demo'
    });
    nws_refreshDashboard();
    brief_generateMockBrief();
    cattle_getSpreadsheet_().setActiveSheet(cattle_getSheet_(CATTLEOS.WATCH_SHEET));
    cattle_uiAlert_('Contest Demo Loaded', 'DEMO DATA — NOT CURRENT OUTBREAK INFORMATION. The scenario includes simulated zones, detections, animals, wound records, tasks, and a mock GPT-5.6 brief.');
    return true;
  });
}

function contest_assertDemoDependencies_(optionalAvailability) {
  var missing = contest_missingDemoDependencies_(optionalAvailability);
  if (!missing.length) return true;
  throw new Error(
    'CattleOS installation is incomplete. RanchBrief.gs is missing or outdated (' +
    missing.join(', ') +
    '). Sync every file from south-texas-cattle-manager, save the Apps Script project, reload the Sheet, and run Setup / Repair Workbook.'
  );
}

function contest_missingDemoDependencies_(optionalAvailability) {
  var availability = optionalAvailability || {
    brief_generateMockBrief: typeof brief_generateMockBrief === 'function',
    brief_getLatestBriefSummary_: typeof brief_getLatestBriefSummary_ === 'function'
  };
  return Object.keys(availability).filter(function(name) {
    return availability[name] !== true;
  });
}

function contest_clearNwsDemoScenario(force) {
  if (force !== true) {
    var ui = SpreadsheetApp.getUi();
    var response = ui.alert('Clear Demo Data', 'Remove rows labeled Data_Mode = Demo and turn off Contest_Demo_Mode? User-entered non-demo rows are preserved.', ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) return false;
  }
  var wasDemo = settings_getBool('Contest_Demo_Mode', false);
  ['Herd', 'Breeding', 'Calves', 'Measurements', 'Health', 'Inspections', 'Expenses', 'Sales_Harvest', 'Feed_Forage', 'Pastures', 'Tasks', 'Alerts', 'NWS_Official_Zones', 'NWS_Official_Cases', 'NWS_Data_Status', 'Ranch_Brief_Log'].forEach(function(sheetName) {
    contest_deleteRowsWhere_(sheetName, function(row) {
      return row.Data_Mode === 'Demo' ||
        (sheetName === 'Calves' && (row.Calf_ID === 'DEMO-CALF-1' || row.Source_Record_ID === 'DEMO_CALF_1'));
    });
  });
  var restored = contest_restorePreDemoSettings_();
  settings_set('Contest_Demo_Mode', false);
  if (wasDemo && !restored) {
    settings_set('Ranch_Name', '');
    settings_set('Acres', '');
    settings_set('Ranch_ZIP', '');
    loc_clearResolvedLocation();
    settings_set('NWS_Data_Health', 'Not Initialized', { editable: false });
    settings_set('NWS_Last_Risk_JSON', '', { editable: false });
  }
  settings_syncZipToWatch_(settings_get('Ranch_ZIP', ''));
  audit_log('INFO', 'CLEAR_DEMO_DATA', 'Contest demo rows cleared.', {});
  if (force !== true) nws_refreshDashboard();
  return true;
}

function contest_seedOfficialDemo_() {
  var zonePolygon = {
    type: 'Polygon',
    coordinates: [[
      [-98.75, 28.75],
      [-98.30, 28.75],
      [-98.30, 29.10],
      [-98.75, 29.10],
      [-98.75, 28.75]
    ]]
  };
  var surveillancePolygon = {
    type: 'Polygon',
    coordinates: [[
      [-98.95, 28.55],
      [-98.10, 28.55],
      [-98.10, 29.30],
      [-98.95, 29.30],
      [-98.95, 28.55]
    ]]
  };
  [
    {
      Zone_Record_ID: 'DEMO_ZONE_INFESTED',
      Source: 'DEMO Texas Animal Health Commission',
      Source_Feature_ID: 'DEMO-IZ-1',
      Zone_Name: 'DEMO Infested Zone',
      Zone_Type: 'Infested Zone',
      County_Names: 'Atascosa County',
      State: 'TX',
      Effective_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
      End_Date: '',
      Official_Status: 'DEMO',
      Geometry_Type: 'Polygon',
      Geometry_GeoJSON: cattle_json_(zonePolygon),
      Source_URL: CATTLEOS.TAHC_MAP_URL,
      Source_Item_ID: CATTLEOS.TAHC_ARCGIS_ITEM_ID,
      Source_Layer_URL: 'DEMO',
      Source_Last_Modified: '',
      Fetched_At: cattle_nowIso_(),
      Data_Mode: 'Demo',
      Raw_Attributes_JSON: cattle_json_({ demo: true })
    },
    {
      Zone_Record_ID: 'DEMO_ZONE_SURVEILLANCE',
      Source: 'DEMO Texas Animal Health Commission',
      Source_Feature_ID: 'DEMO-SZ-1',
      Zone_Name: 'DEMO Adjacent Surveillance Zone',
      Zone_Type: 'Adjacent Surveillance Zone',
      County_Names: 'Atascosa County',
      State: 'TX',
      Effective_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
      End_Date: '',
      Official_Status: 'DEMO',
      Geometry_Type: 'Polygon',
      Geometry_GeoJSON: cattle_json_(surveillancePolygon),
      Source_URL: CATTLEOS.TAHC_MAP_URL,
      Source_Item_ID: CATTLEOS.TAHC_ARCGIS_ITEM_ID,
      Source_Layer_URL: 'DEMO',
      Source_Last_Modified: '',
      Fetched_At: cattle_nowIso_(),
      Data_Mode: 'Demo',
      Raw_Attributes_JSON: cattle_json_({ demo: true })
    }
  ].forEach(function(row) { cattle_appendObject_('NWS_Official_Zones', row); });
  cattle_appendObject_('NWS_Official_Cases', {
    Case_Record_ID: 'DEMO_CASE_1',
    Source: 'DEMO USDA APHIS',
    Official_Case_ID: 'DEMO-CASE-1',
    Detection_Type: 'Confirmed Animal Case',
    State: 'TX',
    County: 'Atascosa County',
    Animal_Type: 'Cattle',
    Species: 'Bovine',
    Confirmation_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Case_Status: 'DEMO',
    Latitude: 28.98,
    Longitude: -98.42,
    Source_URL: CATTLEOS.USDA_CASES_URL,
    Source_Last_Modified: '',
    Fetched_At: cattle_nowIso_(),
    Data_Mode: 'Demo',
    Raw_Attributes_JSON: cattle_json_({ demo: true })
  });
}

function contest_seedHerdDemo_() {
  [
    ['DEMO-101', 'Rio', 'Active', 'Cow', 'Brangus', '2021-03-14', 'North Pasture', 'Demo cow', 'DEMO_HERD_101', 'Demo'],
    ['DEMO-207', 'Mesquite', 'Active', 'Steer', 'Crossbred', '2024-02-02', 'South Trap', 'Open wound demo animal', 'DEMO_HERD_207', 'Demo'],
    ['DEMO-314', 'Pearl', 'Active', 'Cow', 'Hereford', '2020-11-20', 'East Pasture', 'Recent calf pair', 'DEMO_HERD_314', 'Demo']
  ].forEach(function(row) {
    cattle_appendObject_('Herd', {
      Animal_ID: row[0], Name: row[1], Status: row[2], Sex: row[3], Breed: row[4], Birth_Date: row[5],
      Pasture: row[6], Notes: row[7], Source_Record_ID: row[8], Data_Mode: row[9]
    });
  });
  cattle_appendObject_('Calves', {
    Calf_ID: 'DEMO-CALF-1',
    Dam_ID: 'DEMO-314',
    Birth_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Sex: 'Heifer',
    Birth_Weight: '',
    Status: 'Active',
    Notes: 'DEMO recent birth for navel inspection priority.',
    Source_Record_ID: 'DEMO_CALF_1',
    Data_Mode: 'Demo'
  });
}

function contest_seedWorkflowDemo_() {
  var overdue = new Date();
  overdue.setDate(overdue.getDate() - 2);
  var lastInspection = new Date();
  lastInspection.setDate(lastInspection.getDate() - 7);
  cattle_appendObject_('Health', {
    Health_ID: 'DEMO_HEALTH_OPEN_WOUND',
    Animal_ID: 'DEMO-207',
    Event_Date: Utilities.formatDate(overdue, CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Event_Type: 'Injury',
    Severity: 'High',
    Wound_Status: 'Open wound',
    Follow_Up_Due: Utilities.formatDate(overdue, CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Observation: 'DEMO: flank scrape with drainage noted by ranch staff.',
    Resolved: 'FALSE',
    Source_Record_ID: 'DEMO_HEALTH_OPEN_WOUND',
    Data_Mode: 'Demo'
  });
  cattle_appendObject_('Inspections', {
    Inspection_ID: 'DEMO_INSPECTION_1',
    Inspection_Date: Utilities.formatDate(lastInspection, CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Scope: 'Whole Herd',
    Scope_ID: 'WHOLE_HERD',
    Inspector: 'Demo User',
    Findings: 'DEMO whole-herd inspection completed before latest wound follow-up.',
    Suspicious_Larvae_Count: 0,
    Follow_Up_Due: '',
    Source_Record_ID: 'DEMO_INSPECTION_1',
    Data_Mode: 'Demo'
  });
  cattle_appendObject_('Feed_Forage', {
    Feed_ID: 'DEMO_FEED_1',
    Record_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Pasture: 'South Trap',
    Feed_Type: 'Hay',
    Quantity: 'Low',
    Water_Status: 'Trough needs cleaning',
    Concern: 'DEMO feed/water concern for Ranch Brief.',
    Source_Record_ID: 'DEMO_FEED_1',
    Data_Mode: 'Demo'
  });
}

function contest_deleteRowsWhere_(sheetName, predicate) {
  var sheet = cattle_getSheet_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var rows = cattle_sheetRowsAsObjects_(sheetName);
  var deleted = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (predicate(rows[i])) {
      sheet.deleteRow(rows[i]._rowNumber);
      deleted++;
    }
  }
  return deleted;
}

function contest_storePreDemoSettings_() {
  var keys = [
    'Ranch_Name',
    'Owner_Name',
    'Acres',
    'County',
    'Ranch_ZIP',
    'Resolved_City',
    'Resolved_County',
    'Resolved_State',
    'Ranch_Latitude',
    'Ranch_Longitude',
    'Resolved_Latitude',
    'Resolved_Longitude',
    'Location_Source',
    'Location_Resolved_At',
    'NWS_Last_Successful_Refresh',
    'NWS_Last_Source_Modified',
    'NWS_Data_Health',
    'NWS_Last_Risk_JSON',
    'OpenAI_Mock_Mode'
  ];
  var snapshot = {};
  keys.forEach(function(key) {
    snapshot[key] = settings_get(key, '');
  });
  PropertiesService.getDocumentProperties().setProperty('CATTLEOS_PRE_DEMO_SETTINGS', cattle_json_(snapshot));
}

function contest_restorePreDemoSettings_() {
  var properties = PropertiesService.getDocumentProperties();
  var raw = properties.getProperty('CATTLEOS_PRE_DEMO_SETTINGS');
  if (!raw) return false;
  var snapshot = cattle_parseJsonSafe_(raw, null);
  if (!snapshot || typeof snapshot !== 'object') {
    properties.deleteProperty('CATTLEOS_PRE_DEMO_SETTINGS');
    return false;
  }
  Object.keys(snapshot).forEach(function(key) {
    settings_set(key, snapshot[key]);
  });
  properties.deleteProperty('CATTLEOS_PRE_DEMO_SETTINGS');
  return true;
}
