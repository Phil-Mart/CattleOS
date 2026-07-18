function openai_getApiKey_() {
  return PropertiesService.getUserProperties().getProperty('OPENAI_API_KEY') || '';
}

function openai_hasApiKey_() {
  return !!openai_getApiKey_();
}

function openai_setApiKey_(apiKey) {
  apiKey = String(apiKey || '').trim();
  if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(apiKey)) {
    throw new Error('The API key format was not recognized. Paste the full OpenAI API key.');
  }
  PropertiesService.getUserProperties().setProperty('OPENAI_API_KEY', apiKey);
  audit_log('INFO', 'OPENAI_KEY_SET', 'OpenAI API key configured in User Properties.', { keyStatus: 'Configured' });
}

function openai_clearApiKey_() {
  PropertiesService.getUserProperties().deleteProperty('OPENAI_API_KEY');
  audit_log('INFO', 'OPENAI_KEY_CLEARED', 'OpenAI API key cleared from User Properties.', { keyStatus: 'Not Configured' });
}

function openai_callResponses_(payload) {
  var apiKey = openai_getApiKey_();
  if (!apiKey) throw new Error('OpenAI API key is not configured.');
  payload = payload || {};
  payload.store = false;
  var response = UrlFetchApp.fetch(CATTLEOS.OPENAI_RESPONSES_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 300) {
    var parsedError = cattle_parseJsonSafe_(text, {});
    throw new Error('OpenAI Responses API returned HTTP ' + code + ': ' + (parsedError.error && parsedError.error.message ? parsedError.error.message : text.slice(0, 240)));
  }
  var parsed = cattle_parseJsonSafe_(text, null);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OpenAI Responses API returned malformed JSON.');
  }
  if (parsed.error) {
    throw new Error('OpenAI Responses API error: ' + (parsed.error.message || cattle_json_(parsed.error).slice(0, 240)));
  }
  if (parsed.status && parsed.status !== 'completed') {
    var reason = parsed.incomplete_details && parsed.incomplete_details.reason
      ? ': ' + parsed.incomplete_details.reason
      : '';
    throw new Error('OpenAI response did not complete (' + parsed.status + ')' + reason + '.');
  }
  return parsed;
}

function openai_extractResponseText_(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  var chunks = [];
  var refusals = [];
  (response.output || []).forEach(function(output) {
    (output.content || []).forEach(function(content) {
      if (content.type === 'refusal' && content.refusal) refusals.push(content.refusal);
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      else if (content.text) chunks.push(content.text);
    });
  });
  if (!chunks.length && refusals.length) {
    throw new Error('OpenAI declined to produce the Ranch Brief: ' + refusals.join(' ').slice(0, 240));
  }
  return chunks.join('\n').trim();
}
