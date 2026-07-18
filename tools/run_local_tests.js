const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', 'south-texas-cattle-manager');
const files = [
  'Code.gs',
  'SettingsService.gs',
  'WorkbookSetup.gs',
  'LocationService.gs',
  'NwsRiskEngine.gs',
  'ArcGISService.gs',
  'NwsDataService.gs',
  'NwsDashboard.gs',
  'OpenAIService.gs',
  'RanchBrief.gs',
  'ContestDemo.gs',
  'MigrationV11.gs',
  'NwsTests.gs'
];

const context = {
  console,
  Logger: { log: () => {} },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_algorithm, text) => Array.from(crypto.createHash('sha256').update(String(text)).digest()).map(b => b > 127 ? b - 256 : b),
    formatDate: (date) => new Date(date).toISOString(),
    getUuid: () => 'local-test-uuid'
  },
  SpreadsheetApp: {},
  UrlFetchApp: {},
  CacheService: {},
  LockService: {},
  ScriptApp: {},
  PropertiesService: {},
  HtmlService: {},
  Session: { getActiveUser: () => ({ getEmail: () => 'local@test' }) }
};
vm.createContext(context);

for (const file of files) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
}

context.settings_get = (_key, defaultValue) => defaultValue || '';
context.settings_getNumber = (_key, defaultValue) => defaultValue;
context.settings_getBool = (_key, defaultValue) => defaultValue;
context.audit_log = () => {};
context.cattle_uiAlert_ = () => {};

const results = context.test_runPureUnitTests();
console.log(`Passed ${results.length} pure unit tests.`);
