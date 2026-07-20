function brief_setOpenAiApiKey() {
  var html = HtmlService.createHtmlOutputFromFile('OpenAIKeyDialog').setWidth(460).setHeight(280);
  SpreadsheetApp.getUi().showModalDialog(html, 'Set OpenAI API Key');
}

function brief_saveOpenAiApiKey(apiKey) {
  openai_setApiKey_(apiKey);
  settings_set('OpenAI_Enabled', true);
  return { status: 'Configured' };
}

function brief_clearOpenAiApiKey() {
  openai_clearApiKey_();
  settings_set('OpenAI_Enabled', false);
  cattle_uiAlert_('OpenAI API Key', 'OpenAI API key cleared. Ranch Brief mock and deterministic fallback remain available.');
}

function brief_testOpenAiConnection() {
  if (!openai_hasApiKey_()) throw new Error('OpenAI API key is not configured.');
  var model = settings_get('OpenAI_Model', 'gpt-5.6-sol');
  var payload = {
    model: model,
    max_output_tokens: 1000,
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'Return exactly {"ok":true} as JSON.' }] }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'connection_test',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: { ok: { type: 'boolean' } }
        }
      }
    }
  };
  var response = openai_callResponses_(payload);
  var text = openai_extractResponseText_(response);
  var parsed = cattle_parseJsonSafe_(text, null);
  if (!parsed || parsed.ok !== true) throw new Error('OpenAI connection test returned an unexpected response.');
  cattle_uiAlert_('OpenAI Connection', 'Connection succeeded for model ' + model + '.');
  return true;
}

function brief_buildGroundedInput() {
  setup_ensureWorkbookStructure_();
  settings_ensureDefaults();
  var risk = nws_getCachedRiskResult_();
  var allowed = {};
  function allow(id) {
    if (id) allowed[String(id)] = true;
  }
  allow('SYSTEM:RISK');
  allow('SYSTEM:DATA_HEALTH');

  var maxAnimals = Math.max(1, settings_getNumber('Ranch_Brief_Max_Animals', 20));
  var herdRows = cattle_sheetRowsForCurrentMode_('Herd').filter(function(row) {
    return !/sold|deceased|culled|harvested|inactive/i.test(String(row.Status || ''));
  }).slice(0, maxAnimals).map(function(row) {
    var id = brief_sourceId_(row, 'HERD', row.Source_Record_ID || row.Animal_ID);
    allow(id);
    return {
      animal_id: String(row.Animal_ID || ''),
      status: row.Status,
      sex: row.Sex,
      pasture: row.Pasture,
      source_record_id: id
    };
  });
  var allOpenWounds = cattle_sheetRowsForCurrentMode_('Health').filter(function(row) {
    return /open|unresolved|draining|enlarging|foul|screwworm suspected/i.test([row.Wound_Status, row.Event_Type].join(' ')) &&
      !cattle_toBool_(row.Resolved, false);
  });
  var openWounds = allOpenWounds.slice(0, maxAnimals).map(function(row) {
    var id = brief_sourceId_(row, 'HEALTH', row.Source_Record_ID || row.Health_ID);
    allow(id);
    return {
      animal_id: String(row.Animal_ID || ''),
      event_date: row.Event_Date,
      event_type: row.Event_Type,
      wound_status: row.Wound_Status,
      follow_up_due: row.Follow_Up_Due,
      source_record_id: id
    };
  });
  var suspectedById = {};
  allOpenWounds.filter(function(row) {
    return /screwworm suspected/i.test(String(row.Event_Type || ''));
  }).forEach(function(row) {
    suspectedById[brief_sourceId_(row, 'HEALTH', row.Source_Record_ID || row.Health_ID)] = true;
  });
  var inspections = cattle_sheetRowsForCurrentMode_('Inspections').slice(-20).map(function(row) {
    var id = brief_sourceId_(row, 'INSPECTION', row.Source_Record_ID || row.Inspection_ID);
    allow(id);
    if (Number(row.Suspicious_Larvae_Count || 0) > 0) suspectedById[id] = true;
    return {
      inspection_date: row.Inspection_Date,
      scope: row.Scope,
      scope_id: String(row.Scope_ID || ''),
      suspicious_larvae_count: row.Suspicious_Larvae_Count,
      follow_up_due: row.Follow_Up_Due,
      source_record_id: id
    };
  });
  var alerts = cattle_sheetRowsForCurrentMode_('Alerts').filter(function(row) {
    return !/closed|resolved/i.test(String(row.Status || ''));
  }).slice(0, 20).map(function(row) {
    var id = brief_sourceId_(row, 'ALERT', row.Source_Record_ID || row.Alert_ID);
    allow(id);
    return {
      severity: row.Severity,
      message: row.Message,
      source_record_id: id
    };
  });
  var tasks = cattle_sheetRowsForCurrentMode_('Tasks').filter(function(row) {
    return !/complete|closed|done|cancel/i.test(String(row.Status || ''));
  }).slice(0, 30).map(function(row) {
    var id = brief_sourceId_(row, 'TASK', row.Source_Record_ID || row.Task_ID);
    allow(id);
    return {
      task_type: row.Task_Type,
      scope: row.Scope,
      scope_id: String(row.Scope_ID || ''),
      due_date: row.Due_Date,
      priority: row.Priority,
      reason: suspectedById[String(id)] ? 'Suspected finding follow-up; observation text withheld from OpenAI input.' : row.Reason,
      source_record_id: id
    };
  });
  var feed = cattle_sheetRowsForCurrentMode_('Feed_Forage').slice(-15).map(function(row) {
    var id = brief_sourceId_(row, 'FEED', row.Source_Record_ID || row.Feed_ID);
    allow(id);
    return {
      record_date: row.Record_Date,
      pasture: row.Pasture,
      feed_type: row.Feed_Type,
      water_status: row.Water_Status,
      concern: row.Concern,
      source_record_id: id
    };
  });
  var expenses = cattle_sheetRowsForCurrentMode_('Expenses').slice(-20).map(function(row) {
    var id = brief_sourceId_(row, 'EXPENSE', row.Source_Record_ID || row.Expense_ID);
    allow(id);
    return {
      expense_date: row.Expense_Date,
      category: row.Category,
      amount: row.Amount,
      source_record_id: id
    };
  });

  var locationSummary = {
    county: risk.county || '',
    state: risk.state || '',
    location_source: risk.location_source || '',
    official_zone_status: risk.official_zone_status || '',
    operational_attention: risk.operational_attention || '',
    nearest_detection_miles: risk.nearest_detection_miles,
    official_data_health: risk.official_data_health || '',
    official_data_refreshed_at: risk.official_data_refreshed_at || ''
  };
  if (settings_getBool('OpenAI_Send_ZIP', false)) locationSummary.zip = risk.zip || '';

  var input = {
    reporting_period: {
      generated_at: cattle_nowIso_(),
      time_zone: CATTLEOS.TIME_ZONE
    },
    location_summary: locationSummary,
    herd_summary: {
      active_animals_sampled: herdRows.length,
      animals: herdRows
    },
    open_wound_summary: {
      unresolved_count: allOpenWounds.length,
      records: openWounds
    },
    inspection_summary: {
      recent_records: inspections,
      next_recommended_inspection: nws_nextInspectionDue_(risk.operational_attention)
    },
    urgent_alerts: alerts,
    overdue_tasks: tasks.filter(function(row) {
      return cattle_isPastDate_(row.due_date);
    }),
    feed_and_water_summary: feed,
    financial_watchlist: {
      recent_expenses: expenses
    },
    data_quality_issues: brief_dataQualityIssues_(risk),
    allowed_source_record_ids: Object.keys(allowed),
    suspected_source_record_ids: Object.keys(suspectedById)
  };
  return input;
}

function brief_generateRanchBrief() {
  if (settings_getBool('OpenAI_Mock_Mode', true)) {
    return brief_generateMockBrief();
  }
  return brief_generateLiveRanchBrief();
}

function brief_generateLiveRanchBrief() {
  var input = brief_buildGroundedInput();
  if (!settings_getBool('OpenAI_Enabled', false)) throw new Error('OpenAI live mode is not enabled in Settings.');
  if (!openai_hasApiKey_()) throw new Error('OpenAI API key is not configured.');
  if (!brief_confirmSuspectedDataSharing_(input)) {
    cattle_showToast_('Live Ranch Brief canceled. No data were sent to OpenAI.');
    return null;
  }
  var model = settings_get('OpenAI_Model', 'gpt-5.6-sol');
  var output;
  var validation;
  try {
    output = brief_callLiveModel_(input, model, '');
    validation = brief_validateOutput(output, input.allowed_source_record_ids, input.suspected_source_record_ids);
    if (!validation.valid) {
      output = brief_callLiveModel_(input, model, 'Repair the previous response. Validation errors: ' + validation.errors.join('; '));
      validation = brief_validateOutput(output, input.allowed_source_record_ids, input.suspected_source_record_ids);
    }
  } catch (err) {
    audit_log('ERROR', 'BRIEF_LIVE_FAILED', 'Live GPT-5.6 brief failed; using deterministic fallback.', { error: err.message });
    output = brief_generateDeterministicFallback(input);
    validation = { valid: true, errors: [] };
    return brief_logAndRender_(input, output, 'Deterministic Fallback', 'Fallback after live error: ' + err.message, validation);
  }
  if (!validation.valid) {
    var validationErrors = validation.errors.slice();
    audit_log('WARN', 'BRIEF_VALIDATION_FAILED', 'Live GPT-5.6 output failed validation; using deterministic fallback.', { errors: validation.errors });
    output = brief_generateDeterministicFallback(input);
    validation = { valid: true, errors: [] };
    return brief_logAndRender_(input, output, 'Deterministic Fallback', 'Validation fallback after: ' + validationErrors.join('; '), validation);
  }
  return brief_logAndRender_(input, output, 'GPT-5.6 Live', '', validation);
}

function brief_confirmSuspectedDataSharing_(input) {
  if (!input.suspected_source_record_ids || !input.suspected_source_record_ids.length) return true;
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    'Review Suspected Records Before Live GPT',
    brief_suspectedSharingNotice_(input),
    ui.ButtonSet.YES_NO
  );
  return response === ui.Button.YES;
}

function brief_suspectedSharingNotice_(input) {
  var location = input && input.location_summary ? input.location_summary : {};
  var sendsZip = Object.prototype.hasOwnProperty.call(location, 'zip') &&
    !!cattle_normalizeText_(location.zip);
  return 'The grounded brief includes suspected-event type, date, wound status, and source IDs. ' +
    'Exact observation text, coordinates, and owner data are withheld. ' +
    (sendsZip
      ? 'ZIP is included because ZIP sharing is enabled. '
      : 'ZIP is withheld. ') +
    'Send this reviewed summary to OpenAI now?';
}

function brief_generateMockBrief(optionalInput) {
  var input = optionalInput || brief_buildGroundedInput();
  var output = {
    headline: 'MOCK GPT-5.6 Ranch Brief — demo response',
    risk_summary: 'This is a simulated structured response using the same renderer and validator. Operational attention is ' + (input.location_summary.operational_attention || 'Data Unavailable') + '.',
    urgent_actions: input.open_wound_summary.unresolved_count ? [{
      priority: input.location_summary.operational_attention === 'Critical' ? 'Critical' : 'High',
      action: 'Review unresolved wound records and complete the next NWS inspection workflow.',
      reason: 'Open wound records increase inspection priority during NWS watch conditions.',
      source_record_ids: input.open_wound_summary.records.slice(0, 3).map(function(row) { return row.source_record_id; })
    }] : [{
      priority: 'Normal',
      action: 'Keep the next whole-herd inspection on schedule.',
      reason: 'No unresolved wound records were included in the grounded input.',
      source_record_ids: ['SYSTEM:RISK']
    }],
    animals_to_review: input.open_wound_summary.records.slice(0, 5).map(function(row) {
      return {
        animal_id: row.animal_id,
        reason: row.wound_status || row.event_type || 'Wound follow-up',
        source_record_ids: [row.source_record_id]
      };
    }),
    inspection_plan: [{
      scope: 'Whole Herd',
      due: input.inspection_summary.next_recommended_inspection,
      reason: 'Risk-based management cadence from deterministic CattleOS rules.'
    }],
    financial_watchlist: input.financial_watchlist.recent_expenses.length ? ['Review recent feed, veterinary, and inspection-related expenses.'] : [],
    data_quality_issues: input.data_quality_issues,
    questions_for_owner: ['Are exact ranch coordinates available for a more precise local overlay?'],
    safety_note: CATTLEOS.SAFETY_NOTICE
  };
  var validation = brief_validateOutput(output, input.allowed_source_record_ids, input.suspected_source_record_ids);
  return brief_logAndRender_(input, output, 'Mock', '', validation);
}

function brief_generateDeterministicFallback(optionalInput) {
  var input = optionalInput || brief_buildGroundedInput();
  var urgent = [];
  if (input.location_summary.official_data_health === 'Unavailable') {
    urgent.push({
      priority: 'High',
      action: 'Verify current NWS status directly with official TAHC resources before animal movement.',
      reason: 'Official data are unavailable in CattleOS.',
      source_record_ids: ['SYSTEM:DATA_HEALTH']
    });
  }
  input.open_wound_summary.records.slice(0, 5).forEach(function(row) {
    urgent.push({
      priority: /screwworm suspected/i.test(String(row.event_type || '')) ? 'Critical' : 'High',
      action: 'Inspect animal ' + row.animal_id + ' and record follow-up.',
      reason: row.event_type + ' / ' + row.wound_status,
      source_record_ids: [row.source_record_id]
    });
  });
  if (!urgent.length) {
    urgent.push({
      priority: 'Normal',
      action: 'Complete the next scheduled herd inspection.',
      reason: 'No urgent wound records were found in the grounded input.',
      source_record_ids: ['SYSTEM:RISK']
    });
  }
  return {
    headline: 'Deterministic CattleOS Ranch Brief',
    risk_summary: 'Official status: ' + (input.location_summary.official_zone_status || 'Unknown') + '. Operational attention: ' + (input.location_summary.operational_attention || 'Data Unavailable') + '.',
    urgent_actions: urgent.slice(0, 5),
    animals_to_review: input.open_wound_summary.records.slice(0, 5).map(function(row) {
      return { animal_id: row.animal_id, reason: row.event_type + ' / ' + row.wound_status, source_record_ids: [row.source_record_id] };
    }),
    inspection_plan: [{ scope: 'Whole Herd', due: input.inspection_summary.next_recommended_inspection, reason: 'CattleOS risk-based cadence.' }],
    financial_watchlist: [],
    data_quality_issues: input.data_quality_issues,
    questions_for_owner: input.data_quality_issues.length ? ['Can the missing data-quality items be completed?'] : [],
    safety_note: CATTLEOS.SAFETY_NOTICE
  };
}

function brief_validateOutput(output, allowedSourceIds, suspectedSourceIds) {
  var obj = typeof output === 'string' ? cattle_parseJsonSafe_(output, null) : output;
  var allowed = {};
  (allowedSourceIds || []).forEach(function(id) { allowed[String(id)] = true; });
  var suspected = {};
  (suspectedSourceIds || []).forEach(function(id) { suspected[String(id)] = true; });
  var errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { valid: false, errors: ['Output is not a JSON object.'] };
  var requiredFields = ['headline', 'risk_summary', 'urgent_actions', 'animals_to_review', 'inspection_plan', 'financial_watchlist', 'data_quality_issues', 'questions_for_owner', 'safety_note'];
  requiredFields.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) errors.push('Missing field: ' + field);
  });
  Object.keys(obj).forEach(function(field) {
    if (requiredFields.indexOf(field) === -1) errors.push('Unexpected field: ' + field);
  });
  ['headline', 'risk_summary', 'safety_note'].forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(obj, field) && (typeof obj[field] !== 'string' || !obj[field].trim())) {
      errors.push(field + ' must be a non-empty string.');
    }
  });
  var arrayFields = ['urgent_actions', 'animals_to_review', 'inspection_plan', 'financial_watchlist', 'data_quality_issues', 'questions_for_owner'];
  arrayFields.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(obj, field) && !Array.isArray(obj[field])) errors.push(field + ' must be an array.');
  });
  var urgentActions = Array.isArray(obj.urgent_actions) ? obj.urgent_actions : [];
  var animals = Array.isArray(obj.animals_to_review) ? obj.animals_to_review : [];
  var inspectionPlan = Array.isArray(obj.inspection_plan) ? obj.inspection_plan : [];
  if (urgentActions.length > 5) errors.push('urgent_actions must contain no more than five items.');
  urgentActions.forEach(function(action, index) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      errors.push('Urgent action at ' + index + ' must be an object.');
      return;
    }
    ['priority', 'action', 'reason', 'source_record_ids'].forEach(function(field) {
      if (!Object.prototype.hasOwnProperty.call(action, field)) errors.push('Missing urgent action field at ' + index + ': ' + field);
    });
    Object.keys(action).forEach(function(field) {
      if (['priority', 'action', 'reason', 'source_record_ids'].indexOf(field) === -1) errors.push('Unexpected urgent action field at ' + index + ': ' + field);
    });
    if (['Critical', 'High', 'Normal'].indexOf(action.priority) === -1) errors.push('Invalid urgent action priority at ' + index);
    if (typeof action.action !== 'string' || !action.action.trim()) errors.push('Urgent action text is required at ' + index);
    if (typeof action.reason !== 'string' || !action.reason.trim()) errors.push('Urgent action reason is required at ' + index);
    if (!Array.isArray(action.source_record_ids) || !action.source_record_ids.length) errors.push('Urgent action source_record_ids must be a non-empty array at ' + index);
    (Array.isArray(action.source_record_ids) ? action.source_record_ids : []).forEach(function(id) {
      if (typeof id !== 'string' || !id) errors.push('Urgent action source_record_id must be a non-empty string at ' + index);
      if (!allowed[String(id)]) errors.push('Invented or disallowed source_record_id: ' + id);
      if (suspected[String(id)] && brief_claimsSuspectedConfirmation_([action.action, action.reason].join(' '))) {
        errors.push('Suspected record cited as confirmed: ' + id);
      }
    });
  });
  animals.forEach(function(animal, index) {
    if (!animal || typeof animal !== 'object' || Array.isArray(animal)) {
      errors.push('Animal recommendation at ' + index + ' must be an object.');
      return;
    }
    ['animal_id', 'reason', 'source_record_ids'].forEach(function(field) {
      if (!Object.prototype.hasOwnProperty.call(animal, field)) errors.push('Missing animal recommendation field at ' + index + ': ' + field);
    });
    Object.keys(animal).forEach(function(field) {
      if (['animal_id', 'reason', 'source_record_ids'].indexOf(field) === -1) errors.push('Unexpected animal recommendation field at ' + index + ': ' + field);
    });
    if (typeof animal.animal_id !== 'string' || !animal.animal_id.trim()) errors.push('Animal ID is required at ' + index);
    if (typeof animal.reason !== 'string' || !animal.reason.trim()) errors.push('Animal reason is required at ' + index);
    if (!Array.isArray(animal.source_record_ids) || !animal.source_record_ids.length) errors.push('Animal source_record_ids must be a non-empty array at ' + index);
    (Array.isArray(animal.source_record_ids) ? animal.source_record_ids : []).forEach(function(id) {
      if (typeof id !== 'string' || !id) errors.push('Animal source_record_id must be a non-empty string at ' + index);
      if (!allowed[String(id)]) errors.push('Invented animal source_record_id: ' + id);
      if (suspected[String(id)] && brief_claimsSuspectedConfirmation_(animal.reason)) {
        errors.push('Suspected animal record cited as confirmed: ' + id);
      }
    });
  });
  inspectionPlan.forEach(function(item, index) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push('Inspection plan item at ' + index + ' must be an object.');
      return;
    }
    ['scope', 'due', 'reason'].forEach(function(field) {
      if (typeof item[field] !== 'string' || !item[field].trim()) errors.push('Inspection plan ' + field + ' is required at ' + index);
    });
    Object.keys(item).forEach(function(field) {
      if (['scope', 'due', 'reason'].indexOf(field) === -1) errors.push('Unexpected inspection plan field at ' + index + ': ' + field);
    });
  });
  ['financial_watchlist', 'data_quality_issues', 'questions_for_owner'].forEach(function(field) {
    (Array.isArray(obj[field]) ? obj[field] : []).forEach(function(value, index) {
      if (typeof value !== 'string') errors.push(field + ' item at ' + index + ' must be a string.');
    });
  });
  var combined = JSON.stringify(obj).toLowerCase();
  if (/\b(administer|inject|dosage|dose|ivermectin|doramectin)\b|\b(treat|medicate)\s+with\b|\d+\s*(mg|ml|cc|iu)\b/.test(combined)) errors.push('Output appears to recommend a drug, treatment, or dosage.');
  if (/\bmovement (is )?(legal|permitted|allowed)\b/.test(combined)) errors.push('Output appears to determine legal movement permission.');
  return { valid: errors.length === 0, errors: errors, output: obj };
}

function brief_claimsSuspectedConfirmation_(value) {
  var text = cattle_normalizeText_(value).toLowerCase()
    .replace(/\bunconfirmed\b/g, '')
    .replace(/\b(?:not|never)\s+(?:a\s+)?confirmed\b/g, '')
    .replace(/\bcannot\s+be\s+confirmed\b/g, '')
    .replace(/\bno\s+(?:official\s+)?confirmation\b/g, '');
  return /\bconfirmed\b|\bdiagnos(?:e|ed|is)\b|\bpositive\s+(?:case|for\s+(?:new world\s+)?screwworm)\b|\bofficial\s+case\b/.test(text);
}

function brief_renderToDashboard(output, mode) {
  var sheet = cattle_getSheet_(CATTLEOS.DASHBOARD_SHEET);
  if (!sheet) return;
  var start = sheet.getLastRow() + 2;
  var rows = [
    ['Ranch Brief', 'Mode', mode, cattle_nowIso_(), 'OpenAI key is stored only in User Properties'],
    ['Ranch Brief', 'Headline', output.headline, cattle_nowIso_(), ''],
    ['Ranch Brief', 'Risk summary', output.risk_summary, cattle_nowIso_(), ''],
    ['Ranch Brief', 'Urgent actions', (output.urgent_actions || []).map(function(a) { return a.priority + ': ' + a.action + ' (' + (a.source_record_ids || []).join(', ') + ')'; }).join('\n'), cattle_nowIso_(), 'Source record IDs shown for traceability'],
    ['Ranch Brief', 'Animals to review', (output.animals_to_review || []).map(function(a) { return a.animal_id + ': ' + a.reason; }).join('\n'), cattle_nowIso_(), ''],
    ['Ranch Brief', 'Safety note', output.safety_note, cattle_nowIso_(), '']
  ];
  var requiredRows = start + rows.length - 1;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  }
  sheet.getRange(start, 1, rows.length, 5).setValues(cattle_safeMatrix_(rows)).setWrap(true);
}

function brief_getLatestBriefSummary_() {
  var rows = cattle_sheetRowsForCurrentMode_('Ranch_Brief_Log');
  if (!rows.length) return 'No brief generated';
  rows.sort(function(a, b) { return new Date(b.Generated_At) - new Date(a.Generated_At); });
  return rows[0].Generated_At + ' — ' + rows[0].Mode + ' — ' + rows[0].Validation_Status;
}

function brief_getLatestRenderedBrief_() {
  var rows = cattle_sheetRowsForCurrentMode_('Ranch_Brief_Log');
  if (!rows.length) return '';
  rows.sort(function(a, b) { return new Date(b.Generated_At) - new Date(a.Generated_At); });
  return rows[0].Rendered_Brief || '';
}

function brief_callLiveModel_(input, model, repairInstruction) {
  var instruction = [
    'You produce a concise CattleOS Ranch Brief as strict JSON.',
    'Use only supplied data.',
    'Do not invent animals, dates, official zones, cases, distances, treatments, or laws.',
    'Cite source record IDs for every urgent action and animal recommendation.',
    'Distinguish official data from ranch-entered observations.',
    'Do not diagnose, prescribe, or determine legal movement permission.',
    'Say Data unavailable when supporting data are missing.',
    'Prioritize no more than five urgent actions.',
    'Include veterinarian and TAHC escalation when suspicious findings exist.'
  ].join(' ');
  if (repairInstruction) instruction += ' ' + repairInstruction;
  var payload = {
    model: model,
    max_output_tokens: 4000,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: instruction }] },
      { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'cattleos_ranch_brief',
        strict: true,
        schema: brief_outputSchema_()
      }
    }
  };
  var response = openai_callResponses_(payload);
  var text = openai_extractResponseText_(response);
  var parsed = cattle_parseJsonSafe_(text, null);
  if (!parsed) throw new Error('OpenAI response was not parseable JSON.');
  return parsed;
}

function brief_logAndRender_(input, output, mode, errorMessage, validation) {
  validation = validation || brief_validateOutput(output, input.allowed_source_record_ids, input.suspected_source_record_ids);
  var rendered = brief_renderText_(output, mode);
  cattle_appendObject_('Ranch_Brief_Log', {
    Brief_ID: cattle_uuid_('BRIEF'),
    Generated_At: cattle_nowIso_(),
    Generated_By: brief_getActorEmail_(),
    Model: mode === 'GPT-5.6 Live' ? settings_get('OpenAI_Model', 'gpt-5.6-sol') : '',
    Mode: mode,
    Input_Record_Count: input.allowed_source_record_ids.length,
    Input_Hash: cattle_hashString_(JSON.stringify(input)),
    Output_JSON: nws_jsonForCell_(output),
    Rendered_Brief: rendered,
    Validation_Status: validation.valid ? 'Valid' : 'Invalid: ' + validation.errors.join('; '),
    Error_Message: errorMessage || '',
    Data_Mode: settings_getBool('Contest_Demo_Mode', false) ? 'Demo' : ''
  });
  brief_renderToDashboard(output, mode);
  audit_log('INFO', 'GENERATE_RANCH_BRIEF', 'Ranch Brief generated.', { mode: mode, validation: validation.valid ? 'Valid' : validation.errors });
  cattle_showToast_('Ranch Brief generated: ' + mode);
  return output;
}

function brief_getActorEmail_(optionalSession) {
  var sessionService = arguments.length
    ? optionalSession
    : (typeof Session !== 'undefined' ? Session : null);
  try {
    if (!sessionService || typeof sessionService.getActiveUser !== 'function') return '';
    var user = sessionService.getActiveUser();
    return user && typeof user.getEmail === 'function' ? user.getEmail() : '';
  } catch (err) {
    return '';
  }
}

function brief_renderText_(output, mode) {
  return [
    output.headline,
    'Mode: ' + mode,
    'Risk: ' + output.risk_summary,
    'Urgent actions:',
    (output.urgent_actions || []).map(function(a) { return '- ' + a.priority + ': ' + a.action + ' [' + (a.source_record_ids || []).join(', ') + ']'; }).join('\n') || '- None',
    'Animals to review:',
    (output.animals_to_review || []).map(function(a) { return '- ' + a.animal_id + ': ' + a.reason; }).join('\n') || '- None',
    'Safety: ' + output.safety_note
  ].join('\n');
}

function brief_dataQualityIssues_(risk) {
  var issues = [];
  if (!risk.zip) issues.push('Ranch ZIP is not configured.');
  if (!risk.county) issues.push('Resolved county is missing.');
  if (!risk_normalizePoint_({ latitude: risk.latitude, longitude: risk.longitude }).valid) issues.push('Location coordinates are unavailable.');
  if (risk.official_data_health === 'Unavailable') issues.push('Official NWS data are unavailable or hard stale.');
  if (risk.location_source === 'ZIP Centroid') issues.push('Location uses ZIP centroid approximation.');
  return issues;
}

function brief_sourceId_(row, prefix, candidate) {
  if (candidate !== null && candidate !== undefined && String(candidate).trim()) return String(candidate);
  return String(prefix || 'RECORD') + ':ROW:' + String(row && row._rowNumber ? row._rowNumber : 'UNKNOWN');
}

function brief_outputSchema_() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'risk_summary', 'urgent_actions', 'animals_to_review', 'inspection_plan', 'financial_watchlist', 'data_quality_issues', 'questions_for_owner', 'safety_note'],
    properties: {
      headline: { type: 'string' },
      risk_summary: { type: 'string' },
      urgent_actions: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['priority', 'action', 'reason', 'source_record_ids'],
          properties: {
            priority: { type: 'string', enum: ['Critical', 'High', 'Normal'] },
            action: { type: 'string' },
            reason: { type: 'string' },
            source_record_ids: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      animals_to_review: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['animal_id', 'reason', 'source_record_ids'],
          properties: {
            animal_id: { type: 'string' },
            reason: { type: 'string' },
            source_record_ids: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      inspection_plan: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['scope', 'due', 'reason'],
          properties: {
            scope: { type: 'string' },
            due: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      },
      financial_watchlist: { type: 'array', items: { type: 'string' } },
      data_quality_issues: { type: 'array', items: { type: 'string' } },
      questions_for_owner: { type: 'array', items: { type: 'string' } },
      safety_note: { type: 'string' }
    }
  };
}
