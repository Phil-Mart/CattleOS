# Build Week Provenance

## Work Completed Before Build Week

- Original cattle-management concept supplied by the user through the Version 1.1 addendum.
- Prior requirements and schemas implied by the missing `South_Texas_Cattle_Manager_Codex_Project_Spec.md`.
- The original Version 1.0 source/spec was not available in this workspace when Codex started.

## Work Completed During Build Week With Codex

- Baseline CattleOS Google Sheets workbook scaffolding.
- Version 1.1 migration and setup/repair workflow.
- ZIP onboarding and geocoding service.
- TAHC ArcGIS discovery adapter.
- USDA structured-endpoint discovery with official dashboard fallback.
- New World screwworm data-health states and last-known-good behavior.
- Deterministic geospatial risk engine.
- `NWS_Watch` interface, local map dialog, dashboard section, and official links.
- Inspection queue, wound review, suspected-finding alerts, and task automation.
- GPT-5.6 Ranch Brief integration through the Responses API.
- Mock mode, deterministic fallback, structured-output validation, and safe logging.
- Contest demo scenario.
- Automated tests, local test runner, fixtures, README, and submission docs.

## Human Decisions

- Product positioning as a management and awareness tool.
- ZIP-first onboarding with exact-coordinate caveats.
- Official-source hierarchy: TAHC for Texas zones, USDA for confirmed detections.
- Safety boundary and no-diagnosis/no-movement-permission language.
- Contest track: Work & Productivity.
- Demo narrative and judging path.

## Codex Session

Primary Codex task/thread ID: `019f7688-dc03-7673-a561-c14b1915c4cc`

The repository verifies the product's `gpt-5.6-sol` Responses API integration. It does not contain reliable metadata proving which Codex agent model produced each code change, so no agent-model claim is made here.

`/feedback` Session ID: not yet recorded. This is separate from the Codex task/thread ID above. Run `/feedback` in the primary Codex task and record the ID returned by that command if a contest submission requires it.

## Baseline Note

The recommended baseline tag `pre-build-week-baseline` could not be created from existing code because the repository had no commits and no Version 1.0 source files at the start of implementation. The first commit should be treated as the generated contest baseline for this workspace unless the missing Version 1.0 materials are later added.
