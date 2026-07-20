const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');

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

function localBlob(data) {
  const buffer = Buffer.isBuffer(data)
    ? data
    : (Array.isArray(data)
      ? Buffer.from(data.map(value => Number(value) & 255))
      : Buffer.from(String(data), 'utf8'));
  return {
    getBytes: () => Array.from(buffer).map(value => value > 127 ? value - 256 : value),
    getDataAsString: () => buffer.toString('utf8')
  };
}

const context = {
  console,
  Logger: { log: () => {} },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (_algorithm, text) => Array.from(crypto.createHash('sha256').update(String(text)).digest()).map(b => b > 127 ? b - 256 : b),
    formatDate: (date) => new Date(date).toISOString(),
    getUuid: () => 'local-test-uuid',
    newBlob: data => localBlob(data),
    gzip: blob => localBlob(zlib.gzipSync(Buffer.from(blob.getBytes().map(value => value & 255)))),
    ungzip: blob => localBlob(zlib.gunzipSync(Buffer.from(blob.getBytes().map(value => value & 255)))),
    base64Encode: bytes => Buffer.from(bytes.map(value => value & 255)).toString('base64'),
    base64Decode: text => Array.from(Buffer.from(text, 'base64')).map(value => value > 127 ? value - 256 : value)
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

const htmlFiles = ['Onboarding.html', 'OpenAIKeyDialog.html', 'NwsMap.html'];
let htmlChecks = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/gi), match => match[1]);
  for (const [index, script] of scripts.entries()) {
    const compilable = script.replace(/<\?!=\s*mapJson\s*\?>/g, '{}');
    new vm.Script(compilable, { filename: `${file}#script-${index + 1}` });
    htmlChecks++;
  }
}

const onboarding = fs.readFileSync(path.join(root, 'Onboarding.html'), 'utf8');
if (!onboarding.includes('pattern="\\d{5}"')) {
  throw new Error('Onboarding ZIP input must use a five-digit browser validation pattern.');
}
htmlChecks++;
if (!onboarding.includes('/^\\d{5}$/.test')) {
  throw new Error('Onboarding client-side ZIP validation must accept exactly five digits.');
}
htmlChecks++;

const nwsMap = fs.readFileSync(path.join(root, 'NwsMap.html'), 'utf8');
if (!nwsMap.includes('leaflet@1.9.4') || !nwsMap.includes("L.map('map'")) {
  throw new Error('NWS map must load the pinned Leaflet library and initialize an interactive map.');
}
htmlChecks++;
if (!nwsMap.includes('https://tile.openstreetmap.org/{z}/{x}/{y}.png') || !nwsMap.includes('L.geoJSON')) {
  throw new Error('NWS map must render an OpenStreetMap basemap and GeoJSON zone overlays.');
}
htmlChecks++;

const fixtureRoot = path.resolve(__dirname, '..', 'fixtures');
let fixtureChecks = 0;
const layerFixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'arcgis_feature_layer_fixture.json'), 'utf8'));
const fixtureMapping = context.arc_buildFieldMapping_(layerFixture, layerFixture.features[0].attributes);
const fixtureGeoJson = context.arc_esriFeatureSetToGeoJson_(layerFixture);
const fixtureZones = context.arc_normalizeFeatures(fixtureGeoJson, fixtureMapping);
if (fixtureZones.length !== 1 || fixtureZones[0].zone_type !== 'Infested Zone') {
  throw new Error('ArcGIS coded-domain fixture did not normalize as an infested zone.');
}
fixtureChecks++;

const webMapFixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'arcgis_webmap_fixture.json'), 'utf8'));
const fixtureLayers = context.arc_flattenOperationalLayers_(webMapFixture.operationalLayers, 'fixture');
if (fixtureLayers.length !== 2 || fixtureLayers[0].definitionExpression === fixtureLayers[1].definitionExpression) {
  throw new Error('ArcGIS web-map fixture did not preserve distinct layer definition expressions.');
}
fixtureChecks++;

const usdaFixture = fs.readFileSync(path.join(fixtureRoot, 'usda_endpoint_discovery_fixture.html'), 'utf8');
if (context.nws_extractStructuredEndpoints_(usdaFixture).length !== 1) {
  throw new Error('USDA endpoint-discovery fixture did not yield one approved ArcGIS endpoint.');
}
fixtureChecks++;

console.log(`Passed ${results.length} pure unit tests, ${htmlChecks} HTML checks, and ${fixtureChecks} fixture checks.`);
