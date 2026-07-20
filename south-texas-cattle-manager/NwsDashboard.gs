function nws_buildWatchSheet() {
  var sheet = cattle_getOrCreateSheet_(CATTLEOS.WATCH_SHEET);
  sheet.getDataRange().breakApart();
  sheet.clear();
  sheet.setHiddenGridlines(true);
  sheet.getRange('A1:H1').merge().setValue(cattle_safeCellValue_(settings_getRanchName_() + ' — New World Screwworm Watch'))
    .setFontSize(18).setFontWeight('bold').setFontColor('#ffffff').setBackground('#164e63');
  sheet.getRange('A2:H2').merge().setValue(CATTLEOS.SAFETY_NOTICE)
    .setWrap(true).setFontColor('#7f1d1d').setBackground('#fef2f2');
  sheet.getRange('A4:C9').setBackground('#eff6ff');
  sheet.getRange('A4:C4').merge().setValue('ZIP Input').setFontWeight('bold').setFontColor('#0f172a');
  sheet.getRange('A5').setValue('Ranch ZIP Code');
  sheet.getRange('B5').setNumberFormat('@').setBackground('#bfdbfe').setFontWeight('bold');
  sheet.getRange('C5').setValue('Use Cattle Manager → New World Screwworm Watch → Update ZIP / Ranch Location');
  sheet.getRange('A6').setValue('Location source');
  sheet.getRange('A7').setValue('Resolved location');
  sheet.getRange('A8').setValue('Official data health');
  sheet.getRange('A9').setValue('Last successful refresh');
  sheet.getRange('A10:H10').setValues([[
    'Official Zone Status',
    'Operational Attention',
    'Resolved County',
    'Nearest Confirmed Detection',
    'Official Data Health',
    'Last Herd/Wound Inspection',
    'Animals with Open Wounds',
    'Next Inspection Due'
  ]]).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937').setWrap(true);
  sheet.getRange('A11:H11').setBackground('#ffffff').setFontSize(11).setWrap(true);
  sheet.getRange('A13:B22').setValues([
    ['Action', 'How to Run'],
    ['Refresh Official Data', 'Cattle Manager → New World Screwworm Watch → Refresh Official NWS Data'],
    ['Apply ZIP from NWS Watch', 'Enter ZIP in B5, then Cattle Manager → New World Screwworm Watch → Apply ZIP from NWS Watch'],
    ['Open Official TAHC Map', CATTLEOS.TAHC_MAP_URL],
    ['Open USDA Confirmed Detections', CATTLEOS.USDA_CASES_URL],
    ['Start Wound/Screwworm Inspection', 'Cattle Manager → New World Screwworm Watch → Start Wound/Screwworm Inspection'],
    ['Log Suspicious Finding', 'Cattle Manager → New World Screwworm Watch → Log Suspicious Finding'],
    ['Generate Live GPT-5.6 Ranch Brief', 'Cattle Manager → Ranch Brief → Generate Live GPT-5.6 Ranch Brief'],
    ['Set OpenAI API Key', 'Cattle Manager → Ranch Brief → Set OpenAI API Key'],
    ['Map Dialog', 'Cattle Manager → New World Screwworm Watch → Open Local NWS Map']
  ]);
  sheet.getRange('A13:B13').setFontWeight('bold').setBackground('#334155').setFontColor('#ffffff');
  sheet.getRange('A24:H24').merge().setValue('Map and Source Context')
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#334155');
  sheet.getRange('A25:H30').merge().setValue('Use the menu to open the local map dialog. The local map centers on the configured ranch location, labels the marker as ZIP centroid or exact coordinates, and includes official-source links. If official polygons cannot be queried, use the official TAHC interactive map.')
    .setWrap(true).setVerticalAlignment('top').setBackground('#f8fafc');
  sheet.getRange('A32:H32').merge().setValue('DEMO DATA — NOT CURRENT OUTBREAK INFORMATION')
    .setFontWeight('bold').setFontColor('#991b1b').setBackground('#fee2e2');
  sheet.hideRows(32);
  var validation = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=REGEXMATCH(B5,"^\\d{5}$")')
    .setAllowInvalid(false)
    .setHelpText('Enter exactly five digits. ZIP+4 is not supported in Version 1.1.')
    .build();
  sheet.getRange('B5').setDataValidation(validation);
  var ss = cattle_getSpreadsheet_();
  ss.getNamedRanges().forEach(function(namedRange) {
    if (namedRange.getName() === 'RANCH_ZIP_INPUT') namedRange.remove();
  });
  ss.setNamedRange('RANCH_ZIP_INPUT', sheet.getRange('B5'));
  sheet.setColumnWidths(1, 8, 145);
  sheet.setRowHeights(10, 2, 46);
  sheet.getRange('A:H').setVerticalAlignment('middle');
  settings_syncZipToWatch_(settings_get('Ranch_ZIP', ''));
}

function nws_buildMainDashboard() {
  var sheet = cattle_getOrCreateSheet_(CATTLEOS.DASHBOARD_SHEET);
  sheet.getDataRange().breakApart();
  sheet.clear();
  sheet.setHiddenGridlines(true);
  sheet.getRange('A1:E1').merge().setValue('CattleOS Dashboard')
    .setFontSize(18).setFontWeight('bold').setFontColor('#ffffff').setBackground('#14532d');
  sheet.getRange('A2:E2').merge().setValue(CATTLEOS.SAFETY_NOTICE)
    .setWrap(true).setFontColor('#7f1d1d').setBackground('#fef2f2');
  sheet.getRange('A4:E4').setValues([['Section', 'Metric', 'Value', 'Updated At', 'Source / Note']])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f2937');
  sheet.setFrozenRows(4);
  sheet.setColumnWidths(1, 5, 170);
}

function nws_refreshDashboard() {
  setup_ensureWorkbookStructure_();
  settings_ensureDefaults();
  var result;
  try {
    result = loc_buildResultWithRisk();
    settings_set('NWS_Last_Risk_JSON', cattle_json_(result), { editable: false });
  } catch (err) {
    result = nws_emptyRiskResult_(err.message);
    settings_set('NWS_Last_Risk_JSON', cattle_json_(result), { editable: false });
    audit_log('WARN', 'RISK_EVALUATION_FAILED', 'Risk evaluation failed.', { error: err.message });
  }
  nws_createSuspectedCaseAlert();
  var inspectionQueue = nws_buildInspectionQueue();
  var workflow = nws_buildWorkflowSummary_(result.operational_attention, inspectionQueue);
  nws_renderWatch_(result, workflow);
  nws_renderDashboard_(result, workflow);
  if (settings_getBool('NWS_Create_Inspection_Tasks', true)) {
    nws_createRiskBasedInspectionTasks(inspectionQueue, workflow.nextInspectionDue);
  }
  return result;
}

function nws_openWatch() {
  var result = nws_refreshDashboard();
  cattle_getSpreadsheet_().setActiveSheet(cattle_getSheet_(CATTLEOS.WATCH_SHEET));
  return result;
}

function nws_updateRanchLocationFromPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('Update Ranch Location', 'Enter the five-digit ranch ZIP code. ZIP results use a ZIP centroid unless exact coordinates are set in Settings.', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var zip = response.getResponseText();
  var location = loc_updateFromZip(zip);
  settings_syncZipToWatch_(location.zip);
  nws_refreshDashboard();
  ui.alert('Location Updated', 'Resolved ' + (location.city || 'unknown city') + ', ' + (location.county || 'unknown county') + ', ' + (location.state || 'unknown state') + '. Location source: ' + location.location_source + '.', ui.ButtonSet.OK);
}

function nws_updateZipFromWatch() {
  var range = cattle_getSpreadsheet_().getRangeByName('RANCH_ZIP_INPUT');
  if (!range) throw new Error('Named range RANCH_ZIP_INPUT was not found. Run Setup / Repair Workbook.');
  var location = loc_updateFromZip(range.getDisplayValue());
  nws_refreshDashboard();
  return location;
}

function nws_openOfficialTahcMap() {
  cattle_openUrlDialog_('Official TAHC Map', CATTLEOS.TAHC_MAP_URL);
}

function nws_openUsdaConfirmedDetections() {
  cattle_openUrlDialog_('USDA Confirmed Detections', CATTLEOS.USDA_CASES_URL);
}

function nws_openMapDialog() {
  var template = HtmlService.createTemplateFromFile('NwsMap');
  template.mapJson = cattle_safeJsonForHtml_(nws_getMapData_());
  var html = template.evaluate().setWidth(820).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'CattleOS NWS Map');
}

function nws_renderWatch_(result, workflow) {
  var sheet = cattle_getSheet_(CATTLEOS.WATCH_SHEET);
  if (!sheet) return;
  var health = nws_getDataHealth();
  sheet.getRange('A1:H1').setValue(cattle_safeCellValue_(settings_getRanchName_() + ' — New World Screwworm Watch'));
  settings_syncZipToWatch_(result.zip || '');
  sheet.getRange('B6').setValue(cattle_safeCellValue_(result.location_source || ''));
  sheet.getRange('B7').setValue(cattle_safeCellValue_([result.city, result.county, result.state].filter(String).join(', ')));
  sheet.getRange('B8').setValue(cattle_safeCellValue_(nws_describeDataHealth_(health)));
  sheet.getRange('B9').setValue(cattle_safeCellValue_(result.official_data_refreshed_at || health.lastSuccess || 'No successful refresh'));
  var statusValues = [[
    result.official_zone_status || 'Unknown',
    result.operational_attention || 'Data Unavailable',
    result.county || '',
    cattle_formatDistance_(result.nearest_detection_miles) +
      (result.nearest_detection_precision ? ' (approx. county centroid)' : ''),
    result.official_data_health || health.state,
    workflow ? workflow.lastInspectionSummary : nws_getLastInspectionSummary_(),
    workflow ? workflow.animalsWithOpenWounds.length : nws_findAnimalsWithOpenWounds_().length,
    workflow ? workflow.nextInspectionDue : nws_nextInspectionDue_(result.operational_attention)
  ]];
  sheet.getRange('A11:H11').setValues(cattle_safeMatrix_(statusValues)).setWrap(true);
  var color = nws_attentionColor_(result.operational_attention);
  sheet.getRange('B11').setBackground(color.background).setFontColor(color.foreground).setFontWeight('bold');
  sheet.getRange('E11').setBackground(nws_healthColor_(result.official_data_health));
  if (settings_getBool('Contest_Demo_Mode', false)) sheet.showRows(32);
  else sheet.hideRows(32);
  sheet.getRange('A25:H30').setValue(
    'Local result: ' + (result.explanation || 'No evaluation available.') + '\n\n' +
    'Location marker: ' + (result.location_source || 'Not configured') + '. ' +
    'Official data: ' + nws_describeDataHealth_(nws_getDataHealth()) + '.\n\n' +
    'TAHC map: ' + CATTLEOS.TAHC_MAP_URL + '\n' +
    'USDA dashboard: ' + CATTLEOS.USDA_CASES_URL
  ).setWrap(true);
}

function nws_renderDashboard_(result, workflow) {
  var sheet = cattle_getSheet_(CATTLEOS.DASHBOARD_SHEET);
  if (!sheet) return;
  if (sheet.getLastRow() < 4) nws_buildMainDashboard();
  var now = cattle_nowIso_();
  var rows = [
    ['New World Screwworm Watch', 'Ranch location', [result.city, result.county, result.state, result.zip].filter(String).join(', '), now, result.location_source || 'Not configured'],
    ['New World Screwworm Watch', 'Location precision', result.location_precision || '', now, CATTLEOS.SAFETY_NOTICE],
    ['New World Screwworm Watch', 'Official zone status', result.official_zone_status, now, result.explanation || ''],
    ['New World Screwworm Watch', 'Operational attention', result.operational_attention, now, 'Management workflow level, not a legal status'],
    ['New World Screwworm Watch', 'Nearest confirmed detection', cattle_formatDistance_(result.nearest_detection_miles), now,
      [result.nearest_detection_county, result.nearest_detection_precision].filter(String).join(' - ') || 'Shown only when coordinates are reliable'],
    ['New World Screwworm Watch', 'Official data health', result.official_data_health, now, nws_describeDataHealth_(nws_getDataHealth())],
    ['New World Screwworm Watch', 'Last official refresh', result.official_data_refreshed_at || '', now, 'Live, delayed, unavailable, and demo states remain visible'],
    ['Herd Workflow', 'Last whole-herd inspection', workflow ? workflow.lastInspectionSummary : nws_getLastInspectionSummary_(), now, 'From Inspections sheet'],
    ['Herd Workflow', 'Animals with unresolved open wounds', workflow ? workflow.animalsWithOpenWounds.length : nws_findAnimalsWithOpenWounds_().length, now, 'From Health records'],
    ['Herd Workflow', 'Overdue wound follow-ups', workflow ? workflow.overdueWoundFollowUps : nws_countOverdueWoundFollowUps_(), now, 'From Health follow-up due dates'],
    ['Herd Workflow', 'Next recommended inspection', workflow ? workflow.nextInspectionDue : nws_nextInspectionDue_(result.operational_attention), now, 'Risk-based cadence is a management default'],
    ['Ranch Brief', 'Latest brief', nws_getLatestBriefSummarySafe_(), now, 'OpenAI live, mock, or deterministic fallback']
  ];
  sheet.getRange(5, 1, Math.max(sheet.getMaxRows() - 4, 1), 5).clearContent();
  sheet.getRange(5, 1, rows.length, 5).setValues(cattle_safeMatrix_(rows)).setWrap(true);
  var banner = nws_dashboardBanner_(result);
  sheet.getRange('A3:E3').merge().setValue(banner.message).setFontWeight('bold').setWrap(true)
    .setBackground(banner.background).setFontColor(banner.foreground);
  sheet.autoResizeColumns(1, 5);
}

function nws_getLatestBriefSummarySafe_(optionalGetter) {
  var getter = arguments.length
    ? optionalGetter
    : (typeof brief_getLatestBriefSummary_ === 'function' ? brief_getLatestBriefSummary_ : null);
  if (typeof getter !== 'function') return 'Ranch Brief unavailable - sync RanchBrief.gs';
  return getter();
}

function nws_buildInspectionQueue() {
  var queue = [];
  var today = new Date();
  cattle_sheetRowsForCurrentMode_('Health').forEach(function(row) {
    var eventType = String(row.Event_Type || '');
    var woundStatus = String(row.Wound_Status || '');
    var resolved = cattle_toBool_(row.Resolved, false);
    var sourceId = row.Source_Record_ID || row.Health_ID || '';
    var review = nws_classifyHealthReview_(eventType, woundStatus, resolved);
    if (review) {
      queue.push(nws_queueItem_(review.priority, review.rank, row.Animal_ID, review.reason, sourceId, row.Follow_Up_Due));
    }
    if (cattle_isPastDate_(row.Follow_Up_Due, today) && !resolved) {
      queue.push(nws_queueItem_('High', 6, row.Animal_ID, 'Overdue health follow-up', sourceId, row.Follow_Up_Due));
    }
  });
  cattle_sheetRowsForCurrentMode_('Calves').forEach(function(row) {
    if (!row.Birth_Date) return;
    var birthDate = cattle_parseDate_(row.Birth_Date);
    if (!birthDate) return;
    var ageDays = (today.getTime() - birthDate.getTime()) / 86400000;
    if (ageDays >= 0 && ageDays <= 14) {
      queue.push(nws_queueItem_('High', 3, row.Calf_ID, 'Recent birth and navel site review', row.Source_Record_ID || row.Calf_ID, ''));
    }
  });
  cattle_sheetRowsForCurrentMode_('Pastures').forEach(function(row) {
    if (/heavy|high/i.test(String(row.Fly_Pressure || ''))) {
      queue.push(nws_queueItem_('Normal', 7, row.Pasture_ID || row.Pasture_Name, 'Pasture has heavy fly pressure', row.Source_Record_ID || row.Pasture_ID, '', 'Pasture'));
    }
  });
  queue.push(nws_queueItem_('Normal', 8, 'WHOLE_HERD', 'Whole-herd check', 'WHOLE_HERD', '', 'Whole Herd'));
  queue.sort(function(a, b) { return a.rank - b.rank; });
  return queue;
}

function nws_createRiskBasedInspectionTasks(optionalQueue, optionalDueDate) {
  if (!settings_getBool('NWS_Create_Inspection_Tasks', true)) return 0;
  var risk = nws_getCachedRiskResult_();
  var attention = risk.operational_attention || 'Routine';
  var dueDate = optionalDueDate || nws_nextInspectionDue_(attention);
  var created = 0;
  var queue = (optionalQueue || nws_buildInspectionQueue()).slice(0, 25);
  var openTaskKeys = {};
  var openRiskScopes = {};
  var processedScopes = {};
  var tasksSheet = cattle_getSheet_('Tasks');
  var taskMap = tasksSheet ? cattle_getHeaderMap_(tasksSheet) : {};
  var updated = 0;
  cattle_sheetRowsForCurrentMode_('Tasks').forEach(function(row) {
    if (/complete|done|closed|cancel/i.test(String(row.Status || ''))) return;
    if (row.Task_Key) openTaskKeys[String(row.Task_Key)] = true;
    if (row.Task_Type === 'NWS Inspection') {
      openRiskScopes[String(row.Scope || '') + ':' + String(row.Scope_ID || '')] = row;
    }
  });
  queue.forEach(function(item) {
    var scope = item.scope || (item.scopeId === 'WHOLE_HERD' ? 'Whole Herd' : 'Animal');
    var itemDueDate = nws_earlierDate_(item.dueDate, dueDate);
    var key = 'NWS_INSPECTION:' + scope + ':' + item.scopeId + ':' + attention + ':' + itemDueDate;
    var riskScopeKey = scope + ':' + item.scopeId;
    if (processedScopes[riskScopeKey]) return;
    processedScopes[riskScopeKey] = true;
    var desiredPriority = attention === 'Critical' || item.priority === 'Critical'
      ? 'Critical'
      : (attention === 'Heightened' || item.priority === 'High' ? 'High' : 'Normal');
    var desiredReason = item.reason + ' — created from ' + attention + ' operational attention.';
    var existingTask = openRiskScopes[riskScopeKey];
    if (existingTask) {
      var tightenedDueDate = nws_earlierDate_(existingTask.Due_Date, itemDueDate);
      var tightenedPriority = nws_moreUrgentPriority_(existingTask.Priority, desiredPriority);
      var existingDueKey = nws_dateKey_(existingTask.Due_Date);
      var tightenedDueKey = nws_dateKey_(tightenedDueDate);
      var dueWasTightened = existingDueKey !== tightenedDueKey;
      var shouldReplaceContext = tightenedPriority === desiredPriority ||
        dueWasTightened;
      var changed = false;
      if (taskMap.Due_Date && dueWasTightened) {
        tasksSheet.getRange(existingTask._rowNumber, taskMap.Due_Date).setValue(tightenedDueDate);
        changed = true;
      }
      if (taskMap.Priority && String(existingTask.Priority || '') !== tightenedPriority) {
        tasksSheet.getRange(existingTask._rowNumber, taskMap.Priority).setValue(tightenedPriority);
        changed = true;
      }
      if (shouldReplaceContext && taskMap.Reason && String(existingTask.Reason || '') !== desiredReason) {
        tasksSheet.getRange(existingTask._rowNumber, taskMap.Reason).setValue(cattle_safeCellValue_(desiredReason));
        changed = true;
      }
      if (shouldReplaceContext && taskMap.Source_Record_ID && String(existingTask.Source_Record_ID || '') !== String(item.sourceRecordId || '')) {
        tasksSheet.getRange(existingTask._rowNumber, taskMap.Source_Record_ID).setValue(cattle_safeCellValue_(item.sourceRecordId || ''));
        changed = true;
      }
      if (changed) updated++;
      return;
    }
    if (openTaskKeys[key]) return;
    var task = {
      Task_ID: cattle_uuid_('TASK'),
      Task_Key: key,
      Task_Type: 'NWS Inspection',
      Scope: scope,
      Scope_ID: item.scopeId,
      Due_Date: itemDueDate,
      Priority: desiredPriority,
      Status: 'Open',
      Reason: desiredReason,
      Created_At: cattle_nowIso_(),
      Completed_At: '',
      Source_Record_ID: item.sourceRecordId,
      Data_Mode: settings_getBool('Contest_Demo_Mode', false) ? 'Demo' : ''
    };
    cattle_appendObject_('Tasks', task);
    openTaskKeys[key] = true;
    openRiskScopes[riskScopeKey] = task;
    created++;
  });
  if (created || updated) {
    audit_log('INFO', 'CREATE_NWS_TASKS', 'Risk-based NWS inspection tasks synchronized.', {
      created: created,
      updated: updated,
      attention: attention,
      dueDate: dueDate
    });
  }
  return created;
}

function nws_findAnimalsNeedingWoundReview(optionalQueue) {
  var animalIds = {};
  (optionalQueue || nws_buildInspectionQueue()).forEach(function(item) {
    if (item.scope === 'Animal' && item.scopeId && item.rank <= 6) animalIds[item.scopeId] = true;
  });
  return Object.keys(animalIds);
}

function nws_findAnimalsWithOpenWounds_(optionalQueue) {
  var animalIds = {};
  (optionalQueue || nws_buildInspectionQueue()).forEach(function(item) {
    if (item.scope === 'Animal' && item.scopeId && (item.rank === 1 || item.rank === 2)) {
      animalIds[item.scopeId] = true;
    }
  });
  return Object.keys(animalIds);
}

function nws_createSuspectedCaseAlert() {
  var count = 0;
  var activeKeys = {};
  var openTaskKeys = {};
  cattle_sheetRowsForCurrentMode_('Tasks').forEach(function(row) {
    if (row.Task_Key && !/complete|done|closed|cancel/i.test(String(row.Status || ''))) {
      openTaskKeys[String(row.Task_Key)] = true;
    }
  });
  cattle_sheetRowsForCurrentMode_('Health').forEach(function(row) {
    if (/screwworm suspected/i.test(String(row.Event_Type || '')) && !cattle_toBool_(row.Resolved, false)) {
      activeKeys[nws_suspectedAlertKey_(row.Animal_ID, row.Source_Record_ID || row.Health_ID || '')] = true;
      count += nws_upsertSuspectedAlert_(row.Animal_ID, row.Source_Record_ID || row.Health_ID || '', row.Observation || '', openTaskKeys);
    }
  });
  cattle_sheetRowsForCurrentMode_('Inspections').forEach(function(row) {
    if (Number(row.Suspicious_Larvae_Count || 0) > 0) {
      activeKeys[nws_suspectedAlertKey_(row.Scope_ID || row.Scope || '', row.Source_Record_ID || row.Inspection_ID || '')] = true;
      count += nws_upsertSuspectedAlert_(row.Scope_ID || row.Scope || '', row.Source_Record_ID || row.Inspection_ID || '', row.Findings || '', openTaskKeys);
    }
  });
  nws_closeClearedSuspectedAlerts_(activeKeys);
  return count;
}

function nws_startWoundInspection() {
  var id = cattle_uuid_('INSPECTION');
  cattle_appendObject_('Inspections', {
    Inspection_ID: id,
    Inspection_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Scope: 'Whole Herd',
    Scope_ID: 'WHOLE_HERD',
    Inspector: '',
    Findings: 'NWS wound/screwworm inspection started. Record animal observations without diagnosing or confirming disease.',
    Suspicious_Larvae_Count: 0,
    Follow_Up_Due: '',
    Source_Record_ID: id,
    Data_Mode: settings_getBool('Contest_Demo_Mode', false) ? 'Demo' : ''
  });
  cattle_getSpreadsheet_().setActiveSheet(cattle_getSheet_('Inspections'));
  cattle_uiAlert_('Inspection Started', 'A whole-herd NWS inspection row was created. If you observe suspicious larvae, contact a veterinarian and TAHC through official reporting channels. Do not mark a suspected observation as confirmed.');
  return id;
}

function nws_logSuspiciousFinding() {
  var ui = SpreadsheetApp.getUi();
  var animal = ui.prompt('Log Suspicious Finding', 'Enter the animal ID or scope. This remains a ranch observation, not a confirmed case.', ui.ButtonSet.OK_CANCEL);
  if (animal.getSelectedButton() !== ui.Button.OK) return;
  var observation = ui.prompt('Observation', 'Preserve the observation exactly. Do not include a diagnosis or treatment plan.', ui.ButtonSet.OK_CANCEL);
  if (observation.getSelectedButton() !== ui.Button.OK) return;
  var id = cattle_uuid_('HEALTH');
  cattle_appendObject_('Health', {
    Health_ID: id,
    Animal_ID: animal.getResponseText(),
    Event_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Event_Type: 'Screwworm Suspected',
    Severity: 'Critical',
    Wound_Status: 'Unresolved',
    Follow_Up_Due: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
    Observation: observation.getResponseText(),
    Resolved: 'FALSE',
    Source_Record_ID: id,
    Data_Mode: settings_getBool('Contest_Demo_Mode', false) ? 'Demo' : ''
  });
  nws_createSuspectedCaseAlert();
  cattle_uiAlert_('Critical Alert Created', 'Contact a veterinarian and the Texas Animal Health Commission through official reporting channels. This workbook does not diagnose or submit a report.');
  return id;
}

function nws_getMapData_() {
  var result = nws_getCachedRiskResult_();
  var zones = nws_getStoredZones_().filter(function(row) {
    return risk_zoneIsActive_(row);
  }).map(function(row) {
    return {
      name: row.Zone_Name,
      type: row.Zone_Type,
      mode: row.Data_Mode,
      geometry: nws_parseGeometryCell_(row.Geometry_GeoJSON)
    };
  }).filter(function(row) { return row.geometry; }).slice(0, 60);
  var cases = nws_getStoredCases_().map(function(row) {
    var point = risk_normalizePoint_({ latitude: row.Latitude, longitude: row.Longitude });
    var raw = cattle_parseJsonSafe_(row.Raw_Attributes_JSON, {});
    return {
      id: row.Case_Record_ID,
      type: row.Detection_Type,
      county: row.County,
      mode: row.Data_Mode,
      coordinatePrecision: raw.coordinate_precision || '',
      latitude: point.valid ? point.lat : null,
      longitude: point.valid ? point.lng : null
    };
  }).filter(function(row) { return row.latitude !== null && row.longitude !== null; }).slice(0, 100);
  return {
    result: result,
    zones: zones,
    cases: cases,
    tahcUrl: CATTLEOS.TAHC_MAP_URL,
    usdaUrl: CATTLEOS.USDA_CASES_URL,
    safetyNotice: CATTLEOS.SAFETY_NOTICE,
    generatedAt: cattle_nowIso_()
  };
}

function nws_getCachedRiskResult_() {
  return cattle_parseJsonSafe_(settings_get('NWS_Last_Risk_JSON', ''), null) || nws_emptyRiskResult_('No cached risk result. Refresh the dashboard.');
}

function nws_emptyRiskResult_(message) {
  var location = loc_getRanchLocation();
  return {
    zip: location.zip || '',
    city: location.city || '',
    county: location.county || '',
    state: location.state || '',
    latitude: location.latitude,
    longitude: location.longitude,
    location_source: location.location_source || '',
    location_precision: location.location_precision || '',
    resolved_at: location.resolved_at || '',
    official_zone_status: 'Unknown',
    operational_attention: 'Data Unavailable',
    nearest_detection_miles: null,
    nearest_detection_county: '',
    nearest_detection_precision: '',
    official_data_health: settings_get('NWS_Data_Health', 'Not Initialized'),
    official_data_refreshed_at: settings_get('NWS_Last_Successful_Refresh', ''),
    caveats: ['ZIP centroid is not the exact ranch location', 'Official zones may cover only part of a county'],
    source_links: [],
    explanation: message || 'Data unavailable',
    evaluated_at: cattle_nowIso_()
  };
}

function nws_queueItem_(priority, rank, scopeId, reason, sourceRecordId, dueDate, scope) {
  return {
    priority: priority,
    rank: rank,
    scope: scope || (scopeId === 'WHOLE_HERD' ? 'Whole Herd' : 'Animal'),
    scopeId: String(scopeId || ''),
    reason: reason,
    sourceRecordId: sourceRecordId || '',
    dueDate: dueDate || ''
  };
}

function nws_classifyHealthReview_(eventType, woundStatus, resolved) {
  if (cattle_toBool_(resolved, false)) return null;
  var event = String(eventType || '');
  var wound = String(woundStatus || '');
  if (/screwworm suspected/i.test(event)) {
    return { priority: 'Critical', rank: 1, reason: 'Unresolved screwworm-suspected observation' };
  }
  if (/open|unresolved/i.test(wound)) {
    return { priority: 'High', rank: 2, reason: 'Open or unresolved wound requires review' };
  }
  if (/castrat|dehorn|brand|surgery|injury|wound/i.test(event)) {
    return { priority: 'High', rank: 4, reason: 'Recent procedure or injury site requires review' };
  }
  if (/draining|enlarging|foul/i.test(wound)) {
    return { priority: 'High', rank: 5, reason: 'Wound condition requires prompt review' };
  }
  return null;
}

function nws_nextInspectionDue_(attention, optionalBaseDate) {
  var days = settings_getNumber('Inspection_Cadence_Normal_Days', 14);
  if (attention === 'Heightened') days = settings_getNumber('Inspection_Cadence_Heightened_Days', 3);
  if (attention === 'Critical') days = settings_getNumber('Inspection_Cadence_Critical_Days', 1);
  if (attention === 'Data Unavailable') days = settings_getNumber('Inspection_Cadence_Heightened_Days', 3);
  var due = optionalBaseDate ? new Date(optionalBaseDate.getTime()) : (nws_getLastWholeHerdInspectionDate_() || new Date());
  due.setDate(due.getDate() + Math.max(0, Number(days)));
  return Utilities.formatDate(due, CATTLEOS.TIME_ZONE, 'yyyy-MM-dd');
}

function nws_getLastInspectionSummary_() {
  var rows = cattle_sheetRowsForCurrentMode_('Inspections').filter(function(row) {
    return cattle_parseDate_(row.Inspection_Date) && nws_isWholeHerdInspection_(row);
  });
  if (!rows.length) return 'No inspection recorded';
  rows.sort(function(a, b) { return cattle_parseDate_(b.Inspection_Date) - cattle_parseDate_(a.Inspection_Date); });
  return rows[0].Inspection_Date + ' — ' + (rows[0].Scope || 'Inspection');
}

function nws_countOverdueWoundFollowUps_() {
  var today = new Date();
  return cattle_sheetRowsForCurrentMode_('Health').filter(function(row) {
    return cattle_isPastDate_(row.Follow_Up_Due, today) &&
      !cattle_toBool_(row.Resolved, false) &&
      /wound|open|unresolved|screwworm/i.test([row.Event_Type, row.Wound_Status].join(' '));
  }).length;
}

function nws_openTaskExists_(taskKey) {
  return cattle_sheetRowsForCurrentMode_('Tasks').some(function(row) {
    return row.Task_Key === taskKey && !/complete|done|closed|cancel/i.test(String(row.Status || ''));
  });
}

function nws_upsertSuspectedAlert_(scopeId, sourceRecordId, observation, openTaskKeys) {
  var alertKey = nws_suspectedAlertKey_(scopeId, sourceRecordId);
  var existing = cattle_sheetRowsForCurrentMode_('Alerts').filter(function(row) {
    return row.Alert_Key === alertKey;
  })[0] || {};
  cattle_upsertByKey_('Alerts', 'Alert_Key', alertKey, {
    Alert_ID: existing.Alert_ID || 'ALERT:' + cattle_hashString_(alertKey),
    Alert_Key: alertKey,
    Severity: 'Critical',
    Status: 'Open',
    Message: 'Suspected screwworm observation recorded for ' + (scopeId || 'unknown scope') + '. Contact a veterinarian and TAHC through official reporting channels. This is not a confirmed case. TAHC: ' + CATTLEOS.TAHC_PAGE_URL,
    Created_At: existing.Created_At || cattle_nowIso_(),
    Updated_At: cattle_nowIso_(),
    Source_Record_ID: sourceRecordId,
    Data_Mode: settings_getBool('Contest_Demo_Mode', false) ? 'Demo' : ''
  });
  var taskKey = 'NWS_SUSPECTED_FOLLOWUP:' + String(sourceRecordId || scopeId || 'UNKNOWN');
  var hasCompleteTaskMap = !!openTaskKeys;
  openTaskKeys = openTaskKeys || {};
  if (!openTaskKeys[taskKey] && (hasCompleteTaskMap || !nws_openTaskExists_(taskKey))) {
    cattle_appendObject_('Tasks', {
      Task_ID: 'TASK:' + cattle_hashString_(taskKey),
      Task_Key: taskKey,
      Task_Type: 'Critical Follow-up',
      Scope: 'Animal',
      Scope_ID: scopeId,
      Due_Date: Utilities.formatDate(new Date(), CATTLEOS.TIME_ZONE, 'yyyy-MM-dd'),
      Priority: 'Critical',
      Status: 'Open',
      Reason: 'Suspected finding requires veterinarian and TAHC escalation. User observation preserved: ' + String(observation || '').slice(0, 240),
      Created_At: cattle_nowIso_(),
      Completed_At: '',
      Source_Record_ID: sourceRecordId,
      Data_Mode: settings_getBool('Contest_Demo_Mode', false) ? 'Demo' : ''
    });
    openTaskKeys[taskKey] = true;
  }
  return 1;
}

function nws_suspectedAlertKey_(scopeId, sourceRecordId) {
  return 'NWS_SUSPECTED:' + String(sourceRecordId || scopeId || 'UNKNOWN');
}

function nws_closeClearedSuspectedAlerts_(activeKeys) {
  var sheet = cattle_getSheet_('Alerts');
  if (!sheet || sheet.getLastRow() < 2) return;
  var map = cattle_getHeaderMap_(sheet);
  cattle_sheetRowsForCurrentMode_('Alerts').forEach(function(row) {
    var key = String(row.Alert_Key || '');
    if (key.indexOf('NWS_SUSPECTED:') !== 0 || activeKeys[key]) return;
    if (/closed|resolved|cancel/i.test(String(row.Status || ''))) return;
    if (map.Status) sheet.getRange(row._rowNumber, map.Status).setValue('Closed');
    if (map.Updated_At) sheet.getRange(row._rowNumber, map.Updated_At).setValue(cattle_nowIso_());
  });
}

function nws_earlierDate_(candidate, fallback) {
  var candidateDate = cattle_parseDate_(candidate);
  var fallbackDate = cattle_parseDate_(fallback);
  if (!candidateDate) return fallback;
  if (!fallbackDate || candidateDate.getTime() < fallbackDate.getTime()) {
    return Utilities.formatDate(candidateDate, CATTLEOS.TIME_ZONE, 'yyyy-MM-dd');
  }
  return fallback;
}

function nws_moreUrgentPriority_(left, right) {
  var ranks = { Critical: 1, High: 2, Normal: 3 };
  var leftPriority = ranks[left] ? left : '';
  var rightPriority = ranks[right] ? right : '';
  if (!leftPriority) return rightPriority || 'Normal';
  if (!rightPriority) return leftPriority;
  return ranks[leftPriority] <= ranks[rightPriority] ? leftPriority : rightPriority;
}

function nws_dateKey_(value) {
  var date = cattle_parseDate_(value);
  return date ? Utilities.formatDate(date, CATTLEOS.TIME_ZONE, 'yyyy-MM-dd') : cattle_normalizeText_(value);
}

function nws_isWholeHerdInspection_(row) {
  row = row || {};
  return String(row.Scope_ID || '').toUpperCase() === 'WHOLE_HERD' ||
    /whole\s*herd|herd[\s-]*wide|all\s+(animals|cattle)/i.test(String(row.Scope || ''));
}

function nws_getLastWholeHerdInspectionDate_() {
  var dates = cattle_sheetRowsForCurrentMode_('Inspections').filter(function(row) {
    return row.Inspection_Date && nws_isWholeHerdInspection_(row);
  }).map(function(row) {
    return cattle_parseDate_(row.Inspection_Date);
  }).filter(function(date) {
    return !!date;
  });
  if (!dates.length) return null;
  dates.sort(function(a, b) { return b.getTime() - a.getTime(); });
  return new Date(dates[0].getTime());
}

function nws_buildWorkflowSummary_(attention, queue) {
  queue = queue || nws_buildInspectionQueue();
  var inspections = cattle_sheetRowsForCurrentMode_('Inspections').filter(function(row) {
    return cattle_parseDate_(row.Inspection_Date) && nws_isWholeHerdInspection_(row);
  });
  inspections.sort(function(a, b) {
    return cattle_parseDate_(b.Inspection_Date) - cattle_parseDate_(a.Inspection_Date);
  });
  var lastDate = inspections.length ? cattle_parseDate_(inspections[0].Inspection_Date) : null;
  return {
    lastInspectionSummary: inspections.length
      ? inspections[0].Inspection_Date + ' — ' + (inspections[0].Scope || 'Inspection')
      : 'No inspection recorded',
    animalsNeedingReview: nws_findAnimalsNeedingWoundReview(queue),
    animalsWithOpenWounds: nws_findAnimalsWithOpenWounds_(queue),
    overdueWoundFollowUps: queue.filter(function(item) {
      return item.rank === 6 && item.reason === 'Overdue health follow-up';
    }).length,
    nextInspectionDue: nws_nextInspectionDue_(attention, lastDate)
  };
}

function nws_attentionColor_(attention) {
  if (attention === 'Critical') return { background: '#991b1b', foreground: '#ffffff' };
  if (attention === 'Heightened') return { background: '#f59e0b', foreground: '#111827' };
  if (attention === 'Routine') return { background: '#d1fae5', foreground: '#064e3b' };
  return { background: '#e5e7eb', foreground: '#111827' };
}

function nws_healthColor_(health) {
  if (health === 'Current') return '#d1fae5';
  if (health === 'Delayed') return '#fef3c7';
  if (health === 'Demo') return '#fee2e2';
  return '#e5e7eb';
}

function nws_dashboardBanner_(result) {
  if (!result.zip) return { message: 'Ranch location has not been configured. Enter a five-digit ZIP code to enable ZIP-localized NWS Watch.', background: '#fef3c7', foreground: '#78350f' };
  if (settings_getBool('Contest_Demo_Mode', false)) return { message: 'DEMO DATA — NOT CURRENT OUTBREAK INFORMATION', background: '#fee2e2', foreground: '#991b1b' };
  if (nws_hasOpenSuspectedAlert_()) return { message: 'Suspicious finding alert is open. Contact a veterinarian and TAHC through official reporting channels.', background: '#991b1b', foreground: '#ffffff' };
  if (result.operational_attention === 'Critical') return { message: 'Critical NWS attention: verify status with TAHC and prioritize wound inspections.', background: '#991b1b', foreground: '#ffffff' };
  if (result.official_data_health === 'Unavailable') return { message: 'Official data unavailable. Verify status directly with TAHC before moving animals.', background: '#e5e7eb', foreground: '#111827' };
  if (result.official_data_health === 'Delayed') return { message: 'Official data delayed. Showing last successful data with visible caveats.', background: '#fef3c7', foreground: '#78350f' };
  return { message: 'NWS Watch ready. Keep inspection records current and verify exact regulatory status with official authorities.', background: '#dcfce7', foreground: '#14532d' };
}

function nws_hasOpenSuspectedAlert_() {
  return cattle_sheetRowsForCurrentMode_('Alerts').some(function(row) {
    return String(row.Alert_Key || '').indexOf('NWS_SUSPECTED:') === 0 &&
      !/closed|resolved|cancel/i.test(String(row.Status || ''));
  });
}
