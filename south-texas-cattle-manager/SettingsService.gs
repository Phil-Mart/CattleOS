var CATTLEOS_DEFAULT_SETTINGS = [
  ['Schema_Version', CATTLEOS.VERSION, false, 'Workbook schema version'],
  ['Ranch_Name', '', true, 'Ranch display name'],
  ['Owner_Name', '', true, 'Optional owner name; not sent to OpenAI'],
  ['Acres', '', true, 'Approximate ranch acreage'],
  ['County', '', true, 'User-entered county from Version 1.0, preserved during migration'],
  ['Ranch_ZIP', '', true, 'Required five-digit U.S. ZIP code'],
  ['Resolved_City', '', false, 'Geocoder result'],
  ['Resolved_County', '', false, 'Geocoder or reverse-geocoder result'],
  ['Resolved_State', '', false, 'State abbreviation'],
  ['Ranch_Latitude', '', true, 'Optional exact latitude'],
  ['Ranch_Longitude', '', true, 'Optional exact longitude'],
  ['Resolved_Latitude', '', false, 'Latitude used for ZIP centroid or exact-coordinate calculations'],
  ['Resolved_Longitude', '', false, 'Longitude used for ZIP centroid or exact-coordinate calculations'],
  ['Location_Source', '', false, 'Exact Coordinates or ZIP Centroid'],
  ['Location_Resolved_At', '', false, 'Last successful location resolution'],
  ['NWS_Enable_Live_Data', true, true, 'Enables official-source refresh'],
  ['NWS_Auto_Refresh', true, true, 'Enables scheduled refresh'],
  ['NWS_Refresh_Hours', 12, true, 'Desired refresh cadence; automatic minimum is one hour'],
  ['NWS_Warn_Stale_Hours', 12, true, 'Yellow stale threshold'],
  ['NWS_Hard_Stale_Hours', 48, true, 'Unknown-status threshold'],
  ['NWS_Proximity_Warning_Miles', 50, true, 'Operational proximity threshold, not an official zone'],
  ['NWS_Show_Official_Map', true, true, 'Show official map link or embed'],
  ['NWS_Create_Inspection_Tasks', true, true, 'Creates deduplicated tasks'],
  ['NWS_Last_Successful_Refresh', '', false, 'Managed by script'],
  ['NWS_Last_Source_Modified', '', false, 'Managed by script when available'],
  ['NWS_Data_Health', 'Not Initialized', false, 'Current, Delayed, Unavailable, or Demo'],
  ['NWS_Last_Risk_JSON', '', false, 'Cached deterministic location result'],
  ['Inspection_Cadence_Normal_Days', 14, true, 'Whole-herd inspection interval for Routine attention'],
  ['Inspection_Cadence_Heightened_Days', 3, true, 'Whole-herd inspection interval for Heightened attention'],
  ['Inspection_Cadence_Critical_Days', 1, true, 'Whole-herd inspection interval for Critical attention'],
  ['OpenAI_Model', 'gpt-5.6-sol', true, 'GPT-5.6 model'],
  ['OpenAI_Enabled', false, true, 'User opt-in for live OpenAI calls'],
  ['OpenAI_Mock_Mode', true, true, 'Provides contest demo without a key'],
  ['OpenAI_Send_ZIP', false, true, 'Default false; unnecessary for brief'],
  ['Ranch_Brief_Max_Animals', 20, true, 'Maximum animal records summarized'],
  ['Contest_Demo_Mode', false, true, 'Clearly labels seeded data']
];

function settings_ensureDefaults() {
  var sheet = cattle_ensureHeaders_(CATTLEOS.SETTINGS_SHEET);
  sheet.getRange('B:B').setNumberFormat('@');
  var existing = settings_getAll_();
  CATTLEOS_DEFAULT_SETTINGS.forEach(function(row) {
    var key = row[0];
    if (!Object.prototype.hasOwnProperty.call(existing, key)) {
      sheet.appendRow([key, row[1], row[2] ? 'TRUE' : 'FALSE', row[3], cattle_nowIso_()]);
    }
  });
  settings_formatSheet_();
}

function settings_get(key, defaultValue) {
  var all = settings_getAll_();
  return Object.prototype.hasOwnProperty.call(all, key) ? all[key].value : defaultValue;
}

function settings_getBool(key, defaultValue) {
  return cattle_toBool_(settings_get(key, defaultValue), defaultValue);
}

function settings_getNumber(key, defaultValue) {
  return cattle_toNumber_(settings_get(key, defaultValue), defaultValue);
}

function settings_set(key, value, options) {
  options = options || {};
  var sheet = cattle_ensureHeaders_(CATTLEOS.SETTINGS_SHEET);
  sheet.getRange('B:B').setNumberFormat('@');
  var map = cattle_getHeaderMap_(sheet);
  var keyColumn = map['Setting Key'];
  var valueColumn = map.Value;
  var updatedColumn = map['Updated At'];
  var editableColumn = map.Editable;
  var purposeColumn = map.Purpose;
  var row = settings_findRow_(key);
  if (!row) {
    sheet.appendRow([
      key,
      cattle_safeCellValue_(value == null ? '' : value),
      options.editable === false ? 'FALSE' : 'TRUE',
      cattle_safeCellValue_(options.purpose || ''),
      cattle_nowIso_()
    ]);
    return;
  }
  sheet.getRange(row, valueColumn).setValue(cattle_safeCellValue_(value == null ? '' : value));
  if (updatedColumn) sheet.getRange(row, updatedColumn).setValue(cattle_nowIso_());
  if (Object.prototype.hasOwnProperty.call(options, 'editable') && editableColumn) {
    sheet.getRange(row, editableColumn).setValue(options.editable ? 'TRUE' : 'FALSE');
  }
  if (options.purpose && purposeColumn) {
    sheet.getRange(row, purposeColumn).setValue(cattle_safeCellValue_(options.purpose));
  }
}

function settings_getAll_() {
  var sheet = cattle_getSheet_(CATTLEOS.SETTINGS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return {};
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(5, sheet.getLastColumn())).getValues();
  var result = {};
  values.forEach(function(row, index) {
    var key = cattle_normalizeText_(row[0]);
    if (!key) return;
    result[key] = {
      value: row[1],
      editable: cattle_toBool_(row[2], true),
      purpose: row[3],
      updatedAt: row[4],
      rowNumber: index + 2
    };
  });
  return result;
}

function settings_findRow_(key) {
  var all = settings_getAll_();
  return all[key] ? all[key].rowNumber : 0;
}

function settings_formatSheet_() {
  var sheet = cattle_getSheet_(CATTLEOS.SETTINGS_SHEET);
  if (!sheet) return;
  sheet.autoResizeColumns(1, Math.min(5, sheet.getLastColumn()));
  sheet.getRange('B:B').setNumberFormat('@');
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var editableRange = sheet.getRange(2, 3, rows, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['TRUE', 'FALSE'], true)
    .setAllowInvalid(false)
    .build();
  editableRange.setDataValidation(rule);
}

function settings_syncZipToWatch_(zip) {
  var sheet = cattle_getSheet_(CATTLEOS.WATCH_SHEET);
  if (!sheet) return;
  var range = cattle_getSpreadsheet_().getRangeByName('RANCH_ZIP_INPUT');
  if (range) {
    range.setNumberFormat('@');
    range.setValue(zip || '');
  }
}

function settings_getRanchName_() {
  return cattle_normalizeText_(settings_get('Ranch_Name')) || 'CattleOS Ranch';
}
