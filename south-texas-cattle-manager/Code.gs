/**
 * CattleOS / South Texas Cattle Manager
 * Version 1.1 Contest Edition.
 *
 * Container-bound Google Apps Script project for a Google Sheets workbook.
 */

var CATTLEOS = {
  VERSION: '1.1',
  TIME_ZONE: 'America/Chicago',
  MENU_NAME: 'Cattle Manager',
  TAHC_PAGE_URL: 'https://www.tahc.texas.gov/emergency/nws.html',
  TAHC_MAP_URL: 'https://tahc.maps.arcgis.com/apps/instant/nearby/index.html?appid=8455917e956b474f995cc3b94d3ef54b',
  TAHC_ARCGIS_ITEM_ID: '8455917e956b474f995cc3b94d3ef54b',
  USDA_CASES_URL: 'https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/current-status/us-confirmed-cases-new-world',
  USDA_STATUS_URL: 'https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/current-status',
  USDA_RESPONSE_URL: 'https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/stop-screwworm',
  CENSUS_COUNTY_REFERENCE_YEAR: '2025',
  CENSUS_COUNTY_REFERENCE_BASE_URL: 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/',
  OPENAI_RESPONSES_URL: 'https://api.openai.com/v1/responses',
  SETTINGS_SHEET: 'Settings',
  DASHBOARD_SHEET: 'Dashboard',
  WATCH_SHEET: 'NWS_Watch',
  AUDIT_SHEET: 'Audit_Log',
  RAW_CACHE_LIMIT: 8,
  MAX_CACHE_PAYLOAD_CHARS: 45000,
  MAX_GEOMETRY_CELL_CHARS: 48000,
  MAX_SCRIPT_CACHE_CHARS: 80000,
  EXTERNAL_FETCH_TIMEOUT_SECONDS: 45,
  ARCGIS_GEOMETRY_PRECISION: 6,
  ARCGIS_GEOMETRY_MAX_OFFSET_DEGREES: 0.00015,
  GEOMETRY_GZIP_PREFIX: 'GZIP_BASE64:',
  SAFETY_NOTICE: 'ZIP-based results are approximate and use a ZIP-code centroid unless exact coordinates are supplied. Official zones may cover only part of a county, and workbook geometry may be generalized by about 17 meters. Verify current restrictions, boundary-adjacent properties, and exact property status with the Texas Animal Health Commission before moving animals.'
};

CATTLEOS.VISIBLE_SHEETS = [
  'Dashboard',
  'NWS_Watch',
  'Settings',
  'Herd',
  'Breeding',
  'Calves',
  'Measurements',
  'Health',
  'Inspections',
  'Expenses',
  'Sales_Harvest',
  'Feed_Forage',
  'Pastures',
  'Tasks',
  'Alerts',
  'Help'
];

CATTLEOS.HIDDEN_SHEETS = [
  'NWS_Official_Zones',
  'NWS_Official_Cases',
  'NWS_Data_Status',
  'NWS_Raw_Cache',
  'Ranch_Brief_Log'
];

CATTLEOS.SYSTEM_SHEETS = CATTLEOS.VISIBLE_SHEETS.concat(CATTLEOS.HIDDEN_SHEETS, [CATTLEOS.AUDIT_SHEET]);

CATTLEOS.HEADERS = {
  Dashboard: ['Section', 'Metric', 'Value', 'Updated At', 'Source / Note'],
  NWS_Watch: ['Area', 'Metric', 'Value', 'Updated At', 'Source / Note'],
  Settings: ['Setting Key', 'Value', 'Editable', 'Purpose', 'Updated At'],
  Herd: ['Animal_ID', 'Name', 'Status', 'Sex', 'Breed', 'Birth_Date', 'Pasture', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Breeding: ['Breeding_ID', 'Animal_ID', 'Event_Date', 'Event_Type', 'Bull_ID', 'Expected_Calving_Date', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Calves: ['Calf_ID', 'Dam_ID', 'Birth_Date', 'Sex', 'Birth_Weight', 'Status', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Measurements: ['Measurement_ID', 'Animal_ID', 'Measurement_Date', 'Weight_Lb', 'Body_Condition', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Health: ['Health_ID', 'Animal_ID', 'Event_Date', 'Event_Type', 'Severity', 'Wound_Status', 'Follow_Up_Due', 'Observation', 'Resolved', 'Source_Record_ID', 'Data_Mode'],
  Inspections: ['Inspection_ID', 'Inspection_Date', 'Scope', 'Scope_ID', 'Inspector', 'Findings', 'Suspicious_Larvae_Count', 'Follow_Up_Due', 'Source_Record_ID', 'Data_Mode'],
  Expenses: ['Expense_ID', 'Expense_Date', 'Category', 'Amount', 'Vendor', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Sales_Harvest: ['Sale_ID', 'Sale_Date', 'Animal_ID', 'Buyer', 'Amount', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Feed_Forage: ['Feed_ID', 'Record_Date', 'Pasture', 'Feed_Type', 'Quantity', 'Water_Status', 'Concern', 'Source_Record_ID', 'Data_Mode'],
  Pastures: ['Pasture_ID', 'Pasture_Name', 'Acres', 'Fly_Pressure', 'Water_Source', 'Notes', 'Source_Record_ID', 'Data_Mode'],
  Tasks: ['Task_ID', 'Task_Key', 'Task_Type', 'Scope', 'Scope_ID', 'Due_Date', 'Priority', 'Status', 'Reason', 'Created_At', 'Completed_At', 'Source_Record_ID', 'Data_Mode'],
  Alerts: ['Alert_ID', 'Alert_Key', 'Severity', 'Status', 'Message', 'Created_At', 'Updated_At', 'Source_Record_ID', 'Data_Mode'],
  Help: ['Topic', 'Guidance', 'Official Link'],
  Audit_Log: ['Timestamp', 'Level', 'Action', 'Message', 'Details_JSON'],
  NWS_Official_Zones: ['Zone_Record_ID', 'Source', 'Source_Feature_ID', 'Zone_Name', 'Zone_Type', 'County_Names', 'State', 'Effective_Date', 'End_Date', 'Official_Status', 'Geometry_Type', 'Geometry_GeoJSON', 'Source_URL', 'Source_Item_ID', 'Source_Layer_URL', 'Source_Last_Modified', 'Fetched_At', 'Data_Mode', 'Raw_Attributes_JSON'],
  NWS_Official_Cases: ['Case_Record_ID', 'Source', 'Official_Case_ID', 'Detection_Type', 'State', 'County', 'Animal_Type', 'Species', 'Confirmation_Date', 'Case_Status', 'Latitude', 'Longitude', 'Source_URL', 'Source_Last_Modified', 'Fetched_At', 'Data_Mode', 'Raw_Attributes_JSON'],
  NWS_Data_Status: ['Source_Key', 'Source_Name', 'Source_URL', 'Adapter_Status', 'Last_Attempt', 'Last_Success', 'Source_Last_Modified', 'Records_Received', 'Error_Code', 'Error_Message', 'Using_Last_Known_Good', 'Data_Mode', 'Schema_Fingerprint'],
  NWS_Raw_Cache: ['Cache_Key', 'Source_URL', 'Fetched_At', 'Response_Code', 'Content_Hash', 'Payload_Text'],
  Ranch_Brief_Log: ['Brief_ID', 'Generated_At', 'Generated_By', 'Model', 'Mode', 'Input_Record_Count', 'Input_Hash', 'Output_JSON', 'Rendered_Brief', 'Validation_Status', 'Error_Message', 'Data_Mode']
};

function onOpen(e) {
  cattle_buildMenu_();
}

function onEdit(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  try {
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    if (sheetName === CATTLEOS.WATCH_SHEET && e.range.getA1Notation() === 'B5') {
      cattle_handleEditedZip_(e.range.getDisplayValue(), true);
      return;
    }
    if (sheetName === CATTLEOS.SETTINGS_SHEET && e.range.getRow() > 1) {
      var settingsMap = cattle_getHeaderMap_(sheet);
      var settingKey = settingsMap['Setting Key'] ? sheet.getRange(e.range.getRow(), settingsMap['Setting Key']).getDisplayValue() : '';
      if (settingKey === 'Ranch_ZIP' && e.range.getColumn() === settingsMap.Value) {
        cattle_handleEditedZip_(e.range.getDisplayValue(), false);
        return;
      }
    }
    if (sheetName === 'Health' || sheetName === 'Inspections') {
      var map = cattle_getHeaderMap_(sheet);
      var watchedColumns = sheetName === 'Health'
        ? [map.Event_Type, map.Resolved]
        : [map.Suspicious_Larvae_Count];
      if (watchedColumns.indexOf(e.range.getColumn()) !== -1 && e.range.getRow() > 1) {
        nws_createSuspectedCaseAlert();
      }
    }
  } catch (err) {
    audit_log('WARN', 'ON_EDIT_FAILED', 'An automatic workbook update could not be completed.', {
      error: err.message
    });
  }
}

function cattle_buildMenu_() {
  var ui = SpreadsheetApp.getUi();
  var nwsMenu = ui.createMenu('New World Screwworm Watch')
    .addItem('Open NWS Watch', 'nws_openWatch')
    .addItem('Open Local NWS Map', 'nws_openMapDialog')
    .addItem('Update ZIP / Ranch Location', 'nws_updateRanchLocationFromPrompt')
    .addItem('Apply ZIP from NWS Watch', 'nws_updateZipFromWatch')
    .addItem('Refresh Official NWS Data', 'nws_refreshOfficialDataManual')
    .addItem('Open Official TAHC Map', 'nws_openOfficialTahcMap')
    .addItem('Open USDA Confirmed Detections', 'nws_openUsdaConfirmedDetections')
    .addItem('Start Wound/Screwworm Inspection', 'nws_startWoundInspection')
    .addItem('Log Suspicious Finding', 'nws_logSuspiciousFinding')
    .addItem('Install NWS Refresh Trigger', 'nws_installRefreshTrigger');

  var briefMenu = ui.createMenu('Ranch Brief')
    .addItem('Generate Live GPT-5.6 Ranch Brief', 'brief_generateLiveRanchBrief')
    .addItem('Generate Mock Ranch Brief', 'brief_generateMockBrief')
    .addItem('Set OpenAI API Key', 'brief_setOpenAiApiKey')
    .addItem('Test OpenAI Connection', 'brief_testOpenAiConnection')
    .addItem('Clear OpenAI API Key', 'brief_clearOpenAiApiKey');

  var automationMenu = ui.createMenu('Automation')
    .addItem('Install Weekly Refresh Trigger', 'automation_installWeeklyRefreshTrigger')
    .addItem('Install NWS Refresh Trigger', 'nws_installRefreshTrigger')
    .addItem('Remove Cattle Manager Triggers', 'automation_removeCattleManagerTriggers');

  var demoMenu = ui.createMenu('Demo & Testing')
    .addItem('Load Demo Data', 'contest_loadDemoData')
    .addItem('Load NWS Contest Scenario', 'contest_loadNwsDemoScenario')
    .addItem('Clear Demo Data', 'contest_clearNwsDemoScenario')
    .addItem('Run All Tests', 'test_runAll')
    .addItem('Run Integration Smoke Test', 'test_runIntegrationSmokeTest');

  ui.createMenu(CATTLEOS.MENU_NAME)
    .addItem('Setup / Repair Workbook', 'setup_repairWorkbook')
    .addItem('Open Quick Entry', 'ui_openQuickEntry')
    .addItem('Refresh Dashboard', 'nws_refreshDashboard')
    .addSubMenu(nwsMenu)
    .addSubMenu(briefMenu)
    .addItem('Run Data Audit', 'audit_runDataAudit')
    .addItem('Rebuild Alerts', 'alerts_rebuild')
    .addItem('Create Backup Copy', 'setup_createBackupCopy')
    .addSubMenu(automationMenu)
    .addSubMenu(demoMenu)
    .addItem('Help / About', 'ui_showHelpAbout')
    .addToUi();
}

function setup_repairWorkbook() {
  return setup_initializeWorkbook({ showOnboarding: true, reason: 'manual setup' });
}

function ui_openQuickEntry() {
  cattle_uiAlert_('Quick Entry', 'Quick Entry is available through the Health, Inspections, Tasks, and Feed_Forage sheets in this contest build. Use the Cattle Manager menu for guided NWS workflows.');
}

function ui_showHelpAbout() {
  cattle_uiAlert_('CattleOS Help', 'CattleOS is a cattle-management workbook with a ZIP-localized New World Screwworm Watch. It does not diagnose animals, prescribe treatment, determine legal movement permission, or submit regulatory reports. Official resources: TAHC and USDA links are on the Help and NWS_Watch sheets.');
}

function audit_runDataAudit() {
  setup_ensureWorkbookStructure_();
  nws_refreshDashboard();
  audit_log('INFO', 'DATA_AUDIT', 'Workbook audit completed.', {
    schemaVersion: settings_get('Schema_Version'),
    dataHealth: settings_get('NWS_Data_Health'),
    generatedAt: cattle_nowIso_()
  });
  cattle_showToast_('Data audit complete.');
}

function alerts_rebuild() {
  nws_createRiskBasedInspectionTasks();
  var suspicious = nws_createSuspectedCaseAlert();
  nws_refreshDashboard();
  cattle_showToast_('Alerts rebuilt. Suspicious finding alerts touched: ' + suspicious);
}

function automation_installWeeklyRefreshTrigger() {
  automation_removeTriggersForHandler_('nws_refreshDashboard');
  ScriptApp.newTrigger('nws_refreshDashboard').timeBased().everyWeeks(1).create();
  audit_log('INFO', 'INSTALL_WEEKLY_TRIGGER', 'Weekly dashboard refresh trigger installed.', {});
  cattle_showToast_('Weekly refresh trigger installed.');
}

function automation_removeCattleManagerTriggers() {
  var count = 0;
  var handlers = {
    nws_refreshOfficialData: true,
    nws_refreshDashboard: true
  };
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  audit_log('INFO', 'REMOVE_TRIGGERS', 'Cattle Manager triggers removed.', { count: count });
  cattle_showToast_('Removed ' + count + ' trigger(s).');
}

function automation_removeTriggersForHandler_(handler) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function cattle_getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function cattle_getSheet_(name) {
  return cattle_getSpreadsheet_().getSheetByName(name);
}

function cattle_getOrCreateSheet_(name) {
  var ss = cattle_getSpreadsheet_();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function cattle_setHeaders_(sheet, headers) {
  if (!headers || !headers.length) return;
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#1f2937')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

function cattle_ensureHeaders_(sheetName) {
  var sheet = cattle_getOrCreateSheet_(sheetName);
  var headers = CATTLEOS.HEADERS[sheetName] || [];
  if (!headers.length) return sheet;
  var existingWidth = Math.max(sheet.getLastColumn(), headers.length);
  var existing = existingWidth ? sheet.getRange(1, 1, 1, existingWidth).getValues()[0] : [];
  var missing = [];
  headers.forEach(function(header) {
    if (existing.indexOf(header) === -1) missing.push(header);
  });
  if (sheet.getLastRow() === 0 || existing.filter(String).length === 0) {
    cattle_setHeaders_(sheet, headers);
  } else if (missing.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  } else {
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  }
  return sheet;
}

function cattle_getHeaderMap_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var map = {};
  headers.forEach(function(header, index) {
    if (header !== '') map[String(header)] = index + 1;
  });
  return map;
}

function cattle_sheetRowsAsObjects_(sheetName) {
  var sheet = cattle_getSheet_(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return values.map(function(row, rowIndex) {
    var obj = { _rowNumber: rowIndex + 2 };
    headers.forEach(function(header, index) {
      if (header !== '') obj[String(header)] = row[index];
    });
    return obj;
  });
}

function cattle_sheetRowsForCurrentMode_(sheetName) {
  var rows = cattle_sheetRowsAsObjects_(sheetName);
  var sheet = cattle_getSheet_(sheetName);
  if (!sheet || !cattle_getHeaderMap_(sheet).Data_Mode) return rows;
  var demoMode = settings_getBool('Contest_Demo_Mode', false);
  return rows.filter(function(row) {
    return demoMode ? row.Data_Mode === 'Demo' : row.Data_Mode !== 'Demo';
  });
}

function cattle_upsertByKey_(sheetName, keyColumnName, keyValue, object) {
  var sheet = cattle_ensureHeaders_(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = cattle_getHeaderMap_(sheet);
  var keyColumn = map[keyColumnName];
  if (!keyColumn) throw new Error('Missing key column ' + keyColumnName + ' in ' + sheetName);
  var rowNumber = 0;
  if (sheet.getLastRow() > 1) {
    var keys = sheet.getRange(2, keyColumn, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(keyValue)) {
        rowNumber = i + 2;
        break;
      }
    }
  }
  var row = headers.map(function(header) {
    return cattle_safeCellValue_(
      Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ''
    );
  });
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    rowNumber = sheet.getLastRow();
  }
  return rowNumber;
}

function cattle_appendObject_(sheetName, object) {
  var sheet = cattle_ensureHeaders_(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function(header) {
    return cattle_safeCellValue_(
      Object.prototype.hasOwnProperty.call(object, header) ? object[header] : ''
    );
  }));
  return sheet.getLastRow();
}

function cattle_withDocumentLock_(label, callback) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    return callback();
  } catch (err) {
    audit_log('ERROR', label || 'LOCKED_OPERATION', err.message, { stack: err.stack });
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function cattle_nowIso_() {
  return Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function cattle_daysAgoIso_(days) {
  var date = new Date();
  date.setDate(date.getDate() - days);
  return Utilities.formatDate(date, CATTLEOS.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function cattle_parseDate_(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === 'number' && isFinite(value)) {
    var numericDate = new Date(value);
    return isNaN(numericDate.getTime()) ? null : numericDate;
  }
  var text = String(value).trim();
  var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  var epochMilliseconds = /^\d{11,13}$/.test(text) ? Number(text) : null;
  var date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : (epochMilliseconds !== null ? new Date(epochMilliseconds) : new Date(text));
  if (dateOnly && (
    date.getFullYear() !== Number(dateOnly[1]) ||
    date.getMonth() !== Number(dateOnly[2]) - 1 ||
    date.getDate() !== Number(dateOnly[3])
  )) return null;
  return isNaN(date.getTime()) ? null : date;
}

function cattle_isPastDate_(value, now) {
  var date = cattle_parseDate_(value);
  if (!date) return false;
  var reference = now ? new Date(now.getTime()) : new Date();
  reference.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return date.getTime() < reference.getTime();
}

function cattle_uuid_(prefix) {
  return (prefix || 'ID') + ':' + Utilities.getUuid();
}

function cattle_hashString_(text) {
  text = String(text == null ? '' : text);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return bytes.map(function(byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function cattle_parseJsonSafe_(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function cattle_toBool_(value, defaultValue) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return defaultValue;
  var normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on'].indexOf(normalized) !== -1) return true;
  if (['false', 'no', 'n', '0', 'off'].indexOf(normalized) !== -1) return false;
  return defaultValue;
}

function cattle_toNumber_(value, defaultValue) {
  if (value === '' || value == null) return defaultValue;
  var number = Number(value);
  return isFinite(number) ? number : defaultValue;
}

function cattle_normalizeText_(value) {
  return String(value == null ? '' : value).trim();
}

function cattle_normalizeCounty_(county) {
  var text = cattle_normalizeText_(county);
  return text.replace(/\s+county$/i, '').trim().toLowerCase();
}

function cattle_formatDistance_(miles) {
  if (miles === null || miles === undefined || !isFinite(Number(miles))) return 'Data unavailable';
  return Number(miles).toFixed(Number(miles) < 10 ? 1 : 0) + ' miles';
}

function cattle_json_(value) {
  return JSON.stringify(value == null ? null : value);
}

function cattle_safeJsonForHtml_(value) {
  var json = cattle_json_(value);
  return (json === undefined ? 'null' : json)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function cattle_safeCellValue_(value) {
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

function cattle_safeMatrix_(rows) {
  return (rows || []).map(function(row) {
    return (row || []).map(cattle_safeCellValue_);
  });
}

function cattle_showToast_(message) {
  try {
    cattle_getSpreadsheet_().toast(message, 'CattleOS', 8);
  } catch (err) {
    Logger.log(message);
  }
}

function cattle_uiAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log(title + ': ' + message);
  }
}

function cattle_openUrlDialog_(title, url) {
  var safeUrl = String(url || '');
  if (!/^https:\/\//i.test(safeUrl)) {
    throw new Error('Only HTTPS links can be opened from CattleOS.');
  }
  var escapedUrl = safeUrl
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
  var html = HtmlService.createHtmlOutput(
    '<!doctype html><html><body style="font-family:Arial,sans-serif;padding:16px;line-height:1.4">' +
    '<p>Open the official source in a new tab.</p>' +
    '<p><a href="' + escapedUrl + '" target="_blank" rel="noopener">Open official source</a></p>' +
    '<script>window.open(' + cattle_safeJsonForHtml_(safeUrl) + ', "_blank", "noopener");</script>' +
    '</body></html>'
  ).setWidth(360).setHeight(180);
  SpreadsheetApp.getUi().showModalDialog(html, title || 'Open Source');
}

function cattle_handleEditedZip_(zip, updateSettings) {
  var validation = loc_validateZip(zip);
  if (updateSettings) {
    settings_set('Ranch_ZIP', validation.valid ? validation.zip : zip);
  }
  loc_clearResolvedLocation({ preserveExact: true });
  settings_syncZipToWatch_(validation.valid ? validation.zip : '');
}

function audit_log(level, action, message, details) {
  try {
    var sheet = cattle_ensureHeaders_(CATTLEOS.AUDIT_SHEET);
    sheet.appendRow([
      cattle_nowIso_(),
      level || 'INFO',
      action || '',
      message || '',
      details ? JSON.stringify(details) : ''
    ]);
  } catch (err) {
    Logger.log('Audit log failed: ' + err.message + ' / original: ' + message);
  }
}
