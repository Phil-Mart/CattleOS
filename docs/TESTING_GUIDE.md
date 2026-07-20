# Testing Guide

## Local Tests

Run from the repository root:

```bash
node tools/run_local_tests.js
```

Expected result:

```text
Passed 115 pure unit tests, 7 HTML checks, and 3 fixture checks.
```

Coverage includes:

- ZIP normalization and validation.
- Leading-zero handling.
- Fixture geocoder parsing.
- Polygon, MultiPolygon, holes, boundaries, line-segment distance, invalid geometry, Esri conversion, and compressed geometry round-trips.
- Risk outcomes for infested zones, surveillance zones, affected counties, unknown zone types, nearby detections, delayed data, unavailable data, non-Texas locations, missing ZIPs, and demo mode.
- ArcGIS schema alias/domain mapping, definition-expression preservation, endpoint discovery, and URL-restriction fixtures.
- GPT structured-output validation, invented source ID rejection, treatment/dosage rejection, suspected-record confirmation rejection, and deterministic fallback.
- Date, snapshot comparison, response extraction, and safe HTML-template serialization.
- Formula-like external text sanitization and complete demo/live mode columns.
- Demo dependency preflight and missing Ranch Brief dashboard fallback.
- Interactive OpenStreetMap initialization and GeoJSON zone overlays.
- USDA Tableau CSV discovery, host validation, normalization, and approximate county-centroid metadata.
- Ranch Brief logging when user-email permission is unavailable.
- Browser-side JavaScript compilation and five-digit onboarding ZIP validation.
- Checked-in ArcGIS coded-domain, filtered-web-map, and USDA endpoint-discovery fixtures.

## Apps Script Tests

After installing the project in a Google Sheet:

```text
Cattle Manager → Demo & Testing → Run All Tests
```

The Apps Script test path verifies:

- Blank-workbook setup.
- Sheet creation.
- `RANCH_ZIP_INPUT` named range.
- Required settings.
- Hidden system sheet creation.
- Version 1.1 migration idempotence.
- Pure unit tests listed above.

## Manual Smoke Test

1. Run **Setup / Repair Workbook**.
2. Enter a five-digit ZIP in onboarding.
3. Confirm that `Settings.Ranch_ZIP` and `NWS_Watch` stay synchronized.
4. Verify leading zeroes by testing a ZIP such as `02108`.
5. Load the NWS contest scenario.
6. Confirm the `DEMO DATA — NOT CURRENT OUTBREAK INFORMATION` banner appears.
7. Open the local map dialog.
8. Confirm the ranch marker is labeled `Approximate ZIP centroid`.
9. Generate a mock Ranch Brief.
10. Confirm `Ranch_Brief_Log` records `Mode = Mock`.
11. Clear demo data.
12. Confirm non-demo rows are preserved.

## Live Adapter Smoke Test

1. Set `NWS_Enable_Live_Data = TRUE`.
2. Run **Refresh Official NWS Data**.
3. Check `NWS_Data_Status`.
4. Confirm one of these visible states appears:
   - `Current`
   - `Delayed`
   - `Unavailable`
5. If public layers cannot be queried, confirm the TAHC official map link is still visible and the adapter does not fabricate records.
6. In `NWS_Official_Zones`, confirm large geometry cells begin with `GZIP_BASE64:` rather than being truncated.

## GPT-5.6 Live Smoke Test

1. Set the API key with **Set OpenAI API Key**.
2. Run **Test OpenAI Connection**.
3. Run **Generate Live GPT-5.6 Ranch Brief**.
4. If suspected records are in scope, review the disclosure prompt and explicitly approve or cancel.
5. Confirm:
   - `Ranch_Brief_Log.Mode = GPT-5.6 Live`
   - no API key appears in any sheet
   - the API request uses `store: false`
   - urgent actions cite allowed source record IDs
   - invalid model output falls back deterministically
