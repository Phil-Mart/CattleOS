# CattleOS

**CattleOS** is a Google Sheets operating system for small cattle producers. It combines herd, breeding, health, forage, inspection, expense, and sales records with a ZIP-localized New World Screwworm Watch. Deterministic code resolves the ranch location, retrieves official outbreak data, evaluates mapped zones, and creates inspection workflows. GPT-5.6 converts the verified operational state into a concise Ranch Brief with traceable source-record references. The system does not diagnose animals or determine regulatory movement permission.

## Project Status

This repository contains a complete Google Apps Script source project under `south-texas-cattle-manager/`.

The workspace was empty except for git metadata when Codex began. The Version 1.1 addendum referenced `South_Texas_Cattle_Manager_Codex_Project_Spec.md`, but that original Version 1.0 spec was not present in the workspace or Downloads. Codex therefore built the baseline CattleOS workbook scaffolding required by the addendum and documented that limitation in `docs/BUILD_WEEK_PROVENANCE.md`.

## What Version 1.1 Adds

- ZIP-first onboarding with geocoder-based city/county/state resolution.
- Separate ZIP centroid and exact-coordinate handling.
- `NWS_Watch` visible sheet plus managed NWS system sheets.
- TAHC ArcGIS app discovery and feature-layer querying when public layers are available.
- USDA confirmed-detections adapter with structured-endpoint discovery and official dashboard fallback.
- Current, delayed, unavailable, and demo data-health states.
- Deterministic geospatial risk engine for Polygon, MultiPolygon, holes, boundaries, Esri JSON conversion, and distances.
- Inspection queue and deduplicated task/alert automation for wounds and suspected findings.
- GPT-5.6 Ranch Brief through the OpenAI Responses API, with explicit live/mock actions, structured-output validation, and deterministic fallback.
- Mode-isolated contest demo scenario and automated tests.

## Install

1. Create or open a Google Sheet.
2. Open **Extensions → Apps Script**.
3. Add the files from `south-texas-cattle-manager/` to the Apps Script project, including `appsscript.json`.
4. Save the project.
5. Run `setup_repairWorkbook` once from Apps Script and authorize the requested scopes.
6. Return to the sheet and reload it.
7. Use **Cattle Manager → Setup / Repair Workbook** if the menu is not already visible.

All `.gs` files are required. If a menu action reports that a function such as
`brief_getLatestBriefSummary_` is not defined, the bound Apps Script project is
out of date or missing `RanchBrief.gs`. Replace it with the complete repository
copy, save the project, reload the Sheet, run **Cattle Manager → Setup / Repair
Workbook**, and retry the action. The demo loader checks these dependencies
before changing workbook data.

Optional `clasp` path:

```bash
clasp create --type sheets --title "CattleOS" --rootDir south-texas-cattle-manager
clasp push
```

## Demo Path

Use **Cattle Manager → Demo & Testing → Load NWS Contest Scenario**.

The demo is labeled:

```text
DEMO DATA — NOT CURRENT OUTBREAK INFORMATION
```

It seeds a sample ZIP, simulated official zone geometry, a nearby simulated case, herd records, an open wound, an overdue follow-up, feed/water concern, risk-based tasks, and a mock Ranch Brief. It does not claim live official data or a live GPT call.

## Live Data

Use **Cattle Manager → New World Screwworm Watch → Refresh Official NWS Data**.

The TAHC adapter discovers the ArcGIS app and operational layers, preserves each web-map `definitionExpression`, decodes coded-value field domains, and queries public layers when available. Complete zone refreshes are atomic. Geometry is requested at six-decimal precision with a maximum generalization offset of `0.00015` degrees (about 17 meters), then stored as JSON or lossless gzip/base64 so complete polygons fit Google Sheets cells. Boundary-adjacent properties still require verification on the official TAHC map.

If public layers require authentication, a zone layer is incomplete, or schemas change, CattleOS switches to degraded/delayed/unavailable states, preserves last-known-good data when present, and links the official TAHC map.

The USDA adapter looks for structured public endpoints from the official dashboard page. If none are found, CattleOS uses the official USDA dashboard link instead of scraping rendered text as a live data source.

## Ranch Brief

Mock mode is enabled by default:

```text
OpenAI_Mock_Mode = TRUE
```

For live GPT-5.6:

1. Use **Cattle Manager → Ranch Brief → Set OpenAI API Key**.
2. Optionally use **Test OpenAI Connection**.
3. Use **Generate Live GPT-5.6 Ranch Brief**.

Saving the key enables live mode. The explicit live command does not require changing `OpenAI_Mock_Mode`; that setting controls the compatibility handler while the mock command remains available for demos. If suspected-event records are in scope, CattleOS shows the reviewed fields and requires confirmation before sending the summary. Exact observation text, coordinates, owner information, and ZIP are withheld by default.

The API key is stored only in Apps Script User Properties. It is not written to any sheet or log. Responses API requests set `store: false`.

## Tests

Local deterministic tests:

```bash
node tools/run_local_tests.js
```

Apps Script tests:

```text
Cattle Manager → Demo & Testing → Run All Tests
```

The local runner validates syntax for all `.gs` files, compiles all HTML client scripts, and runs 106 pure tests, 7 HTML checks, and 3 checked-in fixture checks. Apps Script integration tests additionally verify workbook setup, named range creation, migration idempotence, and sheet structure.

## Safety Boundary

ZIP-based results are approximate and use a ZIP-code centroid unless exact coordinates are supplied. Official zones may cover only part of a county. Verify current restrictions and exact property status with the Texas Animal Health Commission before moving animals.

CattleOS never diagnoses New World screwworm, identifies larvae as confirmed, prescribes treatment or dosage, determines legal movement permission, submits regulatory reports, or treats user observations as official detections.

Script-generated external text is forced to plain cell content so it cannot become a Google Sheets formula.

## Submission Docs

- `docs/BUILD_WEEK_PROVENANCE.md`
- `docs/DEMO_SCRIPT.md`
- `docs/TESTING_GUIDE.md`
- `docs/DATA_SOURCES.md`
- `docs/SAFETY_AND_LIMITATIONS.md`

The primary Codex task ID and separate `/feedback` Session ID instructions are in `docs/BUILD_WEEK_PROVENANCE.md`.
