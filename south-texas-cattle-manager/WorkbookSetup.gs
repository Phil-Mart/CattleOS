function setup_initializeWorkbook(options) {
  options = options || {};
  return cattle_withDocumentLock_('SETUP_WORKBOOK', function() {
    setup_ensureWorkbookStructure_();
    settings_ensureDefaults();
    settings_set('Schema_Version', CATTLEOS.VERSION, { editable: false });
    nws_buildWatchSheet();
    nws_buildMainDashboard();
    setup_populateHelpSheet_();
    setup_protectSystemSheets_();
    setup_orderSheets_();
    cattle_buildMenu_();
    audit_log('INFO', 'SETUP_WORKBOOK', 'Workbook setup/repair completed.', options);
    if (options.showOnboarding) {
      setup_showOnboardingDialog_();
    }
    return true;
  });
}

function setup_ensureWorkbookStructure_() {
  CATTLEOS.SYSTEM_SHEETS.forEach(function(sheetName) {
    var sheet = setup_ensureSheetStructure_(sheetName);
    if (CATTLEOS.HIDDEN_SHEETS.indexOf(sheetName) !== -1) {
      try {
        sheet.hideSheet();
      } catch (err) {
        audit_log('WARN', 'HIDE_SHEET_FAILED', 'Could not hide system sheet.', { sheet: sheetName, error: err.message });
      }
    }
  });
}

function setup_ensureSheetStructure_(sheetName) {
  if (sheetName === CATTLEOS.DASHBOARD_SHEET || sheetName === CATTLEOS.WATCH_SHEET) {
    return cattle_getOrCreateSheet_(sheetName);
  }
  return cattle_ensureHeaders_(sheetName);
}

function setup_orderSheets_() {
  var ss = cattle_getSpreadsheet_();
  CATTLEOS.VISIBLE_SHEETS.forEach(function(name, index) {
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(index + 1);
    }
  });
  ss.setActiveSheet(ss.getSheetByName(CATTLEOS.DASHBOARD_SHEET));
}

function setup_protectSystemSheets_() {
  CATTLEOS.HIDDEN_SHEETS.concat([CATTLEOS.AUDIT_SHEET]).forEach(function(sheetName) {
    var sheet = cattle_getSheet_(sheetName);
    if (!sheet) return;
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (!protections.length) {
      var protection = sheet.protect();
      protection.setWarningOnly(true);
      protection.setDescription('CattleOS managed system sheet');
    } else {
      protections.forEach(function(protection) {
        protection.setWarningOnly(true);
      });
    }
  });
}

function setup_populateHelpSheet_() {
  var sheet = cattle_ensureHeaders_('Help');
  if (sheet.getLastRow() > 1) return;
  var rows = [
    ['Safety boundary', 'This workbook is a management and awareness tool. It does not diagnose New World screwworm, prescribe treatment, determine legal movement permission, or submit reports.', CATTLEOS.TAHC_PAGE_URL],
    ['Approximate ZIP results', CATTLEOS.SAFETY_NOTICE, CATTLEOS.TAHC_MAP_URL],
    ['Suspected finding', 'Contact a veterinarian and the Texas Animal Health Commission through official reporting channels. Preserve your observation; do not call it confirmed unless an authority confirms it.', CATTLEOS.TAHC_PAGE_URL],
    ['USDA confirmed detections', 'Use USDA APHIS for national confirmed-detection information when available.', CATTLEOS.USDA_CASES_URL],
    ['OpenAI Ranch Brief', 'OpenAI calls are optional. Mock mode is enabled by default for demo/testing and never claims a live GPT call occurred.', 'https://developers.openai.com/']
  ];
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.autoResizeColumns(1, 3);
}

function setup_createBackupCopy() {
  var ss = cattle_getSpreadsheet_();
  var file = DriveApp.getFileById(ss.getId());
  var copyName = ss.getName() + ' backup ' + Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyyMMdd-HHmmss');
  var copy = file.makeCopy(copyName);
  audit_log('INFO', 'CREATE_BACKUP', 'Created workbook backup copy.', { copyId: copy.getId(), copyName: copyName });
  cattle_uiAlert_('Backup Created', 'Created backup copy: ' + copyName);
  return copy.getId();
}

function setup_createBackupCopy_() {
  try {
    return setup_createBackupCopy();
  } catch (err) {
    audit_log('WARN', 'CREATE_BACKUP_FAILED', 'Backup copy could not be created.', { error: err.message });
    return '';
  }
}

function setup_showOnboardingDialog_() {
  var template = HtmlService.createTemplateFromFile('Onboarding');
  template.safetyNotice = CATTLEOS.SAFETY_NOTICE;
  var html = template.evaluate().setWidth(560).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Set Up CattleOS');
}

function setup_saveOnboarding(form) {
  return cattle_withDocumentLock_('SAVE_ONBOARDING', function() {
    setup_ensureWorkbookStructure_();
    settings_ensureDefaults();
    form = form || {};
    var ranchName = cattle_normalizeText_(form.ranchName);
    var acres = cattle_toNumber_(form.acres, null);
    if (!ranchName) throw new Error('Ranch name is required.');
    if (acres === null || acres <= 0) throw new Error('Acres must be a number greater than zero.');
    var exactCoordinates = loc_validateExactCoordinates_(form.latitude, form.longitude);
    var location = loc_geocodeZip(form.zip);
    if (exactCoordinates.provided) {
      location.latitude = exactCoordinates.latitude;
      location.longitude = exactCoordinates.longitude;
      location.location_source = 'Exact Coordinates';
      location.location_precision = 'Exact coordinates supplied by user';
      try {
        var reverse = loc_reverseGeocode(exactCoordinates.latitude, exactCoordinates.longitude);
        location.city = reverse.city || location.city;
        location.county = reverse.county || location.county;
        location.state = reverse.state || location.state;
      } catch (reverseErr) {
        audit_log('WARN', 'ONBOARDING_REVERSE_GEOCODE_FAILED', 'Exact coordinates were saved, but reverse geocoding failed.', {
          error: reverseErr.message
        });
      }
    }
    settings_set('Ranch_Name', ranchName);
    settings_set('Owner_Name', cattle_normalizeText_(form.ownerName));
    settings_set('Acres', acres);
    loc_saveRanchLocation(location);
    if (settings_getBool('NWS_Enable_Live_Data', true)) {
      try {
        nws_refreshOfficialDataUnlocked_();
      } catch (err) {
        audit_log('WARN', 'ONBOARDING_REFRESH_FAILED', 'Official-data refresh failed during onboarding.', { error: err.message });
      }
    }
    if (settings_getBool('NWS_Auto_Refresh', true)) {
      try {
        nws_installRefreshTrigger();
      } catch (triggerErr) {
        audit_log('WARN', 'ONBOARDING_TRIGGER_FAILED', 'Automatic NWS refresh could not be installed.', {
          error: triggerErr.message
        });
      }
    }
    nws_refreshDashboard();
    var ss = cattle_getSpreadsheet_();
    ss.setActiveSheet(cattle_getSheet_(CATTLEOS.WATCH_SHEET));
    return location;
  });
}

function setup_hasUserRecords_() {
  return ['Herd', 'Health', 'Inspections', 'Tasks', 'Feed_Forage'].some(function(sheetName) {
    var sheet = cattle_getSheet_(sheetName);
    return sheet && sheet.getLastRow() > 1;
  });
}
