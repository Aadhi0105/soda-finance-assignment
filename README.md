# Soda Finance & AI Automation — Track B

Take-home assignment for the Soda Data Finance & AI Automation Intern process.

## Objective

Build the Track B SaaS metrics solution in Google Sheets for three monthly investor metrics:

- Gross Margin %
- CAC Payback Period
- Calculated Billings

The solution is designed around four principles:

1. financial accuracy,
2. deterministic and repeatable automation,
3. explicit validation and exception handling,
4. transparent auditability from source data to reported metrics.

## Deliverable Architecture

The Google Sheets workbook will contain the four required tabs:

- `Data` — normalized, append-only transaction data with source provenance
- `Definitions` — metric definitions, assumptions and finance judgement
- `Components` — monthly calculation components and visible criteria
- `Dashboard` — selectable-month KPIs and charts

The intended audit trail is:

`Dashboard → Components → Data`

## Automation

Monthly ingestion will be automated using Google Apps Script where appropriate.

The automation layer will handle tasks such as:

- source ingestion,
- normalization,
- mapping,
- FX conversion,
- duplicate detection,
- validation,
- exception flagging,
- safe append behaviour.

Deterministic financial calculations will remain transparent and reproducible.

## Validation Philosophy

The solution will not rely on outputs being assumed correct because a formula or script ran successfully.

Checks will be built around:

- source-file structure,
- duplicate detection,
- account mapping,
- source-to-ledger reconciliation,
- intercompany consistency,
- metric identities,
- exception visibility.

Unresolved records will be flagged rather than silently absorbed.

## Repository Scope

This repository contains only work created for the solution.

The original Soda Data assignment pack and source accounting exports are intentionally kept outside version control and must not be committed to this repository.

## Status

Initial project setup.

Metric definitions and account-level calculation logic will be documented after the finance design review.