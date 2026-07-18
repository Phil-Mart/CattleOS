# Safety And Limitations

## Core Safety Notice

ZIP-based results are approximate and use a ZIP-code centroid unless exact coordinates are supplied. Official zones may cover only part of a county. Verify current restrictions and exact property status with the Texas Animal Health Commission before moving animals.

## CattleOS Does Not

- Diagnose New World screwworm.
- Identify larvae from a photograph as a confirmed case.
- Prescribe a drug, dosage, treatment, or off-label use.
- Declare that animal movement is legally permitted.
- Submit a regulatory report.
- Convert a user observation into an official detection.
- Call a county or ranch “safe”.
- Interpret an inactive animal case as release of an official zone.
- Hide stale or unavailable official data.
- Present ZIP-centroid results as exact property-level results.
- Make autonomous culling, treatment, veterinary, tax, or legal decisions.

## Suspected Findings

When a suspected finding is recorded, CattleOS creates a critical alert and follow-up task instructing the user to:

1. contact a veterinarian; and
2. contact the Texas Animal Health Commission through official reporting channels.

CattleOS displays the official TAHC page link instead of hardcoding a phone number as the only reporting path.

## Known Limitations

- The original Version 1.0 project spec was not available in the workspace, so Codex created a baseline scaffold from the Version 1.1 addendum.
- Live TAHC ArcGIS layer schemas may change. The adapter maps fields by names and aliases, but unknown schemas are marked degraded.
- USDA dashboard internals may change. If no stable structured endpoint is discoverable, CattleOS uses the official dashboard link.
- Apps Script cannot guarantee that official map iframes are embeddable; the local map dialog and official new-tab links remain available.
- ZIP centroids are approximate. Exact coordinates can be supplied for local calculations, but exact regulatory determinations still require official verification.
- Local tests do not call live Google, ArcGIS, USDA, or OpenAI services. Apps Script smoke tests are required after installation.
