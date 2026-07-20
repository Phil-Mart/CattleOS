# Data Sources

## Texas Animal Health Commission

TAHC is treated as authoritative for Texas New World screwworm zone status.

- Landing page: <https://www.tahc.texas.gov/emergency/nws.html>
- Official interactive zone map: <https://tahc.maps.arcgis.com/apps/instant/nearby/index.html?appid=8455917e956b474f995cc3b94d3ef54b>
- ArcGIS item metadata: <https://www.arcgis.com/sharing/rest/content/items/8455917e956b474f995cc3b94d3ef54b?f=json>
- ArcGIS item data: <https://www.arcgis.com/sharing/rest/content/items/8455917e956b474f995cc3b94d3ef54b/data?f=json>

The adapter discovers operational layers from the ArcGIS app item and referenced web maps. It preserves each layer's web-map `definitionExpression` and decodes ArcGIS coded-value domains, so multiple official views of one FeatureServer layer remain distinct. It does not hardcode current affected counties as the primary live source.

ArcGIS geometry is requested with `geometryPrecision = 6` and `maxAllowableOffset = 0.00015` degrees (about 17 meters). Complete geometry is stored directly when small enough or losslessly gzip-compressed and base64-encoded when needed. If a complete zone snapshot still cannot fit or any required zone layer fails, the refresh is rejected and prior data are preserved.

## USDA APHIS

USDA APHIS is treated as authoritative for confirmed animal and wild-fly detections.

- Confirmed detections dashboard: <https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/current-status/us-confirmed-cases-new-world>
- Current status landing page: <https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/current-status>
- General response page: <https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/stop-screwworm>

The USDA adapter discovers the official public Tableau view embedded in the APHIS page and downloads its CSV export. It validates the exact USDA dashboard host and expected view path before fetching, then imports case ID, county, state, species, confirmation date, and active/inactive status. If USDA changes or removes that structured export, CattleOS falls back to an approved ArcGIS endpoint when available or otherwise shows the official dashboard link and marks the adapter degraded.

USDA publishes these detections by county rather than premises coordinates. CattleOS geocodes each unique county once and plots an explicitly labeled approximate county centroid. Distances involving these records are management approximations, not premises distances or regulatory boundaries.

## Google Apps Script

Approved Apps Script services:

- `Maps.newGeocoder()` for ZIP geocoding.
- `UrlFetchApp` for official-source and OpenAI HTTPS requests.
- `HtmlService` for onboarding, map, and API-key dialogs.
- `PropertiesService` for configuration and API key storage.
- `CacheService` for short-lived request caching.
- `LockService` for setup, migration, refresh, and writes.
- `ScriptApp` for scheduled refresh triggers.

## OpenAI

The Ranch Brief uses the OpenAI Responses API with the configured model setting:

```text
OpenAI_Model = gpt-5.6-sol
```

Official OpenAI docs list `gpt-5.6-sol` as supporting the Responses endpoint and structured outputs: <https://developers.openai.com/api/docs/models/gpt-5.6-sol>

The structured-output request uses the documented Responses API `text.format` JSON schema pattern: <https://developers.openai.com/api/docs/guides/structured-outputs>

Every Responses API request explicitly sets `store: false`. The API key is stored in Apps Script User Properties and is never written to a sheet or log.

Grounded Ranch Brief input excludes owner information, exact coordinates, and ZIP by default. When suspected-event records are included, exact observation text is withheld and the user must confirm the reviewed summary before any live request is sent.
