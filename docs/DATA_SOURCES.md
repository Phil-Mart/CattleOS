# Data Sources

## Texas Animal Health Commission

TAHC is treated as authoritative for Texas New World screwworm zone status.

- Landing page: <https://www.tahc.texas.gov/emergency/nws.html>
- Official interactive zone map: <https://tahc.maps.arcgis.com/apps/instant/nearby/index.html?appid=8455917e956b474f995cc3b94d3ef54b>
- ArcGIS item metadata: <https://www.arcgis.com/sharing/rest/content/items/8455917e956b474f995cc3b94d3ef54b?f=json>
- ArcGIS item data: <https://www.arcgis.com/sharing/rest/content/items/8455917e956b474f995cc3b94d3ef54b/data?f=json>

The adapter discovers operational layers from the ArcGIS app item and referenced web maps. It does not hardcode current affected counties as the primary live source.

## USDA APHIS

USDA APHIS is treated as authoritative for confirmed animal and wild-fly detections.

- Confirmed detections dashboard: <https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/current-status/us-confirmed-cases-new-world>
- Current status landing page: <https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/current-status>
- General response page: <https://www.aphis.usda.gov/animals/animal-health/livestock-and-poultry-disease/stop-screwworm>

The USDA adapter uses structured public endpoints only when discoverable from the public dashboard page. If no stable endpoint is found, CattleOS shows the official dashboard link and marks the adapter degraded rather than scraping rendered dashboard text as live data.

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

The API key is stored in Apps Script User Properties and is never written to a sheet.
