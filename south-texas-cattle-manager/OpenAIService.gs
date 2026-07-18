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
  return cattle_parseJsonSafe_(text, {});
}

function openai_extractResponseText_(response) {
  if (!response) return '';
  if (response.output_text) return response.output_text;
  var chunks = [];
  (response.output || []).forEach(function(output) {
    (output.content || []).forEach(function(content) {
      if (content.text) chunks.push(content.text);
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
    });
  });
  return chunks.join('\n').trim();
}
