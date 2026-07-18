# Demo Script

Target length: approximately 2 minutes 40 seconds.

## 0:00-0:20 — Problem

Small cattle producers often manage valuable animals, health records, forage, expenses, and outbreak risk through memory, paper, and scattered spreadsheets. CattleOS turns that work into a familiar Google Sheets operating system.

## 0:20-0:45 — ZIP Onboarding

- Open the workbook.
- Run **Cattle Manager → Demo & Testing → Load NWS Contest Scenario**.
- Show `NWS_Watch`.
- Point out the five-digit ZIP, resolved county/state, and `ZIP Centroid` label.
- Read the approximate-location warning.
- Show `Official Data Health = Demo`.

## 0:45-1:15 — Local Outbreak Intelligence

- Open the local NWS map dialog.
- Show the ranch marker labeled as approximate ZIP centroid.
- Show simulated zone polygon and detection marker.
- Open the official TAHC map link in a new tab.
- Explain that deterministic code evaluates official data but the official map remains authoritative.

## 1:15-1:45 — Herd Workflow

- Show the demo animal with an open wound.
- Show the prioritized inspection queue through Tasks.
- Start a wound/screwworm inspection.
- Mention that suspected findings create critical alerts directing the owner to a veterinarian and TAHC reporting channels.
- State that CattleOS does not diagnose or submit reports.

## 1:45-2:15 — GPT-5.6

- Click **Generate Mock Ranch Brief** for the demo path.
- Show urgent actions, animals to review, and source record IDs.
- Explain live mode: set an OpenAI API key in User Properties, disable mock mode, then call GPT-5.6 through the Responses API.
- Emphasize that deterministic code calculates location/risk and GPT-5.6 summarizes only grounded input.

## 2:15-2:40 — Codex and Credibility

- Show the repository structure.
- Mention that Codex built the adapters, migration, risk engine, UI, tests, and docs from the spec.
- Show `docs/BUILD_WEEK_PROVENANCE.md`.
- Close with the product promise: localized, practical inspection workflows without replacing veterinarians or animal-health authorities.
