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
  var herdRows = cattle_sheetRowsAsObjects_('Herd').slice(0, maxAnimals).map(function(row) {
    var id = row.Source_Record_ID || row.Animal_ID;
    allow(id);
    return {
      animal_id: row.Animal_ID,
      status: row.Status,
      sex: row.Sex,
      pasture: row.Pasture,
      source_record_id: id
    };
  });
  var openWounds = cattle_sheetRowsAsObjects_('Health').filter(function(row) {
    return /open|unresolved|draining|enlarging|foul|screwworm suspected/i.test([row.Wound_Status, row.Event_Type].join(' ')) &&
      !cattle_toBool_(row.Resolved, false);
  }).slice(0, maxAnimals).map(function(row) {
    var id = row.Source_Record_ID || row.Health_ID;
    allow(id);
    return {
      animal_id: row.Animal_ID,
      event_date: row.Event_Date,
      event_type: row.Event_Type,
      wound_status: row.Wound_Status,
      follow_up_due: row.Follow_Up_Due,
      source_record_id: id
    };
  });
  var inspections = cattle_sheetRowsAsObjects_('Inspections').slice(-20).map(function(row) {
    var id = row.Source_Record_ID || row.Inspection_ID;
    allow(id);
    return {
      inspection_date: row.Inspection_Date,
      scope: row.Scope,
      scope_id: row.Scope_ID,
      suspicious_larvae_count: row.Suspicious_Larvae_Count,
      follow_up_due: row.Follow_Up_Due,
      source_record_id: id
    };
  });
  var alerts = cattle_sheetRowsAsObjects_('Alerts').filter(function(row) {
    return !/closed|resolved/i.test(String(row.Status || ''));
  }).slice(0, 20).map(function(row) {
    var id = row.Source_Record_ID || row.Alert_ID;
    allow(id);
    return {
      severity: row.Severity,
      message: row.Message,
      source_record_id: id
    };
  });
  var tasks = cattle_sheetRowsAsObjects_('Tasks').filter(function(row) {
    return !/complete|closed|done|cancel/i.test(String(row.Status || ''));
  }).slice(0, 30).map(function(row) {
    var id = row.Source_Record_ID || row.Task_ID;
    allow(id);
    return {
      task_type: row.Task_Type,
      scope: row.Scope,
      scope_id: row.Scope_ID,
      due_date: row.Due_Date,
      priority: row.Priority,
      reason: row.Reason,
      source_record_id: id
    };
  });
  var feed = cattle_sheetRowsAsObjects_('Feed_Forage').slice(-15).map(function(row) {
    var id = row.Source_Record_ID || row.Feed_ID;
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
  var expenses = cattle_sheetRowsAsObjects_('Expenses').slice(-20).map(function(row) {
    var id = row.Source_Record_ID || row.Expense_ID;
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
      unresolved_count: openWounds.length,
      records: openWounds
    },
    inspection_summary: {
      recent_records: inspections,
      next_recommended_inspection: nws_nextInspectionDue_(risk.operational_attention)
    },
    urgent_alerts: alerts,
    overdue_tasks: tasks.filter(function(row) {
      return row.due_date && new Date(row.due_date) < new Date();
    }),
    feed_and_water_summary: feed,
    financial_watchlist: {
      recent_expenses: expenses
    },
    data_quality_issues: brief_dataQualityIssues_(risk),
    allowed_source_record_ids: Object.keys(allowed),
    suspected_source_record_ids: openWounds.filter(function(row) {
      return /screwworm suspected/i.test(String(row.event_type || ''));
    }).map(function(row) { return row.source_record_id; })
  };
  return input;
}

function brief_generateRanchBrief() {
  var input = brief_buildGroundedInput();
  if (settings_getBool('OpenAI_Mock_Mode', true)) {
    return brief_generateMockBrief(input);
  }
  if (!settings_getBool('OpenAI_Enabled', false)) throw new Error('OpenAI live mode is not enabled in Settings.');
  if (!openai_hasApiKey_()) throw new Error('OpenAI API key is not configured.');
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
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['Output is not a JSON object.'] };
  ['headline', 'risk_summary', 'urgent_actions', 'animals_to_review', 'inspection_plan', 'financial_watchlist', 'data_quality_issues', 'questions_for_owner', 'safety_note'].forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) errors.push('Missing field: ' + field);
  });
  ['urgent_actions', 'animals_to_review', 'inspection_plan', 'financial_watchlist', 'data_quality_issues', 'questions_for_owner'].forEach(function(field) {
    if (obj[field] && !Array.isArray(obj[field])) errors.push(field + ' must be an array.');
  });
  (obj.urgent_actions || []).forEach(function(action, index) {
    if (['Critical', 'High', 'Normal'].indexOf(action.priority) === -1) errors.push('Invalid urgent action priority at ' + index);
    (action.source_record_ids || []).forEach(function(id) {
      if (!allowed[String(id)]) errors.push('Invented or disallowed source_record_id: ' + id);
      if (suspected[String(id)] && /confirmed/i.test([action.action, action.reason].join(' '))) errors.push('Suspected record cited as confirmed: ' + id);
    });
  });
  (obj.animals_to_review || []).forEach(function(animal, index) {
    (animal.source_record_ids || []).forEach(function(id) {
      if (!allowed[String(id)]) errors.push('Invented animal source_record_id: ' + id);
      if (suspected[String(id)] && /confirmed/i.test(String(animal.reason || ''))) errors.push('Suspected animal record cited as confirmed: ' + id);
    });
  });
  var combined = JSON.stringify(obj).toLowerCase();
  if (/\b(dosage|dose|administer|inject|ivermectin|doramectin|\d+\s*(mg|ml|cc|iu))\b/.test(combined)) errors.push('Output appears to recommend a drug, treatment, or dosage.');
  if (/\bmovement (is )?(legal|permitted|allowed)\b/.test(combined)) errors.push('Output appears to determine legal movement permission.');
  return { valid: errors.length === 0, errors: errors, output: obj };
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
  sheet.getRange(start, 1, rows.length, 5).setValues(rows).setWrap(true);
}

function brief_getLatestBriefSummary_() {
  var rows = cattle_sheetRowsAsObjects_('Ranch_Brief_Log');
  if (!rows.length) return 'No brief generated';
  rows.sort(function(a, b) { return new Date(b.Generated_At) - new Date(a.Generated_At); });
  return rows[0].Generated_At + ' — ' + rows[0].Mode + ' — ' + rows[0].Validation_Status;
}

function brief_getLatestRenderedBrief_() {
  var rows = cattle_sheetRowsAsObjects_('Ranch_Brief_Log');
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
    Generated_By: Session.getActiveUser ? Session.getActiveUser().getEmail() : '',
    Model: mode === 'GPT-5.6 Live' ? settings_get('OpenAI_Model', 'gpt-5.6-sol') : settings_get('OpenAI_Model', 'gpt-5.6-sol'),
    Mode: mode,
    Input_Record_Count: input.allowed_source_record_ids.length,
    Input_Hash: cattle_hashString_(JSON.stringify(input)),
    Output_JSON: cattle_json_(output),
    Rendered_Brief: rendered,
    Validation_Status: validation.valid ? 'Valid' : 'Invalid: ' + validation.errors.join('; '),
    Error_Message: errorMessage || ''
  });
  brief_renderToDashboard(output, mode);
  audit_log('INFO', 'GENERATE_RANCH_BRIEF', 'Ranch Brief generated.', { mode: mode, validation: validation.valid ? 'Valid' : validation.errors });
  cattle_showToast_('Ranch Brief generated: ' + mode);
  return output;
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
  if (!risk.latitude || !risk.longitude) issues.push('Location coordinates are unavailable.');
  if (risk.official_data_health === 'Unavailable') issues.push('Official NWS data are unavailable or hard stale.');
  if (risk.location_source === 'ZIP Centroid') issues.push('Location uses ZIP centroid approximation.');
  return issues;
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
