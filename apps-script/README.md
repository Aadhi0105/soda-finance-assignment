# Phase B — Exact Online + QuickBooks + Adsolut Apps Script

This folder contains the working ingestion layer for all three Track B accounting sources.

The pipeline now implements:

`Source files -> schema validation -> normalization -> mapping -> validation -> idempotent append to Data`

Supported source systems:

- Soda Data NV — Exact Online
- Soda Data Inc — QuickBooks Online
- NannyML NV — Adsolut

## Google Sheet

https://docs.google.com/spreadsheets/d/1mmunZBcnGFvsTOqdCsKb7n7-GpUwE1qmdanJMK8n9zM/edit

## Private source folder

https://drive.google.com/drive/folders/18WMrbaWxNdIT6-ZQL14YtjdTu5qoodOR

Keep the original candidate `.xlsx` files in that folder unchanged.

## Install / replace in Apps Script

Replace the complete contents of the matching files in the bound Apps Script project:

- `Code.gs`
- `Config.gs`
- `Importers.gs`
- `Normalize.gs`
- `Validation.gs`

The existing `appsscript.json` remains compatible and should keep the Drive v3 advanced service enabled.

Save all files and reload the Google Sheet.

The `Soda Finance` menu should show:

- `Refresh monthly data`
- `Validate setup`
- `Apply workbook protections`

The three source-specific refresh functions remain available in Apps Script for diagnostics, but the normal monthly workflow uses **one menu action only**: `Refresh monthly data`.

## Adsolut source files

The NannyML adapter uses:

- `NannyML_NV - PL transactions by cost centre - Apr-Jun 2026 (Adsolut).xlsx`
- `NannyML_NV - Trial balance - 31-03-2026 (Adsolut).xlsx`
- `NannyML_NV - Trial balance - 30-04-2026 (Adsolut).xlsx`
- `NannyML_NV - Trial balance - 31-05-2026 (Adsolut).xlsx`
- `NannyML_NV - Trial balance - 30-06-2026 (Adsolut).xlsx`
- `Soda_Group - Mapping.xlsx`
- `Soda_Group - Structure IC and FX.xlsx`

The script keeps the latest Drive file for each distinct Adsolut TB snapshot date if duplicate uploads exist.

## Adsolut normalized population

With the supplied source pack, the expected population is:

- 20 `OPENING_BALANCE` rows from the 31-Mar-2026 TB;
- 60 `TB_DERIVED_MOVEMENT` rows: 20 B/S accounts for Apr, May and Jun;
- 93 P&L `JOURNAL_LINE` rows.

Expected total:

`173 normalized rows`

The TB-derived movement rows are explicitly labelled because NannyML does not provide detailed B/S journal exports.

## Adsolut controls

The adapter implements:

- exact 16-column analytical P&L schema validation;
- P&L `Debit - Credit = Amount`;
- EUR source amount validation;
- FY27 Period-to-Date validation;
- source cutoff validation;
- group mapping and documented override logic;
- cumulative P&L transaction reconciliation to each monthly/YTD trial balance;
- deterministic TB-derived B/S movement calculation;
- exact duplicate detection;
- explicit duplicate metric exclusion without deleting either source row;
- NannyML IC consulting / management-fee / current-account checks;
- source-system idempotency.

## Known Adsolut source issues expected to surface

### 1. Exact duplicate

The June Halden IT Consulting row appears twice with the same:

- period;
- date;
- invoice number;
- supplier;
- GL;
- cost centre;
- amount.

Both source rows remain visible.

The first occurrence stays metric-eligible with a duplicate warning.

The second identical occurrence receives:

`DUPLICATE_SOURCE_RECORD;DUPLICATE_EXCLUDED`

with `Validation_Status = FAIL` and `Include_In_Metrics = FALSE`.

### 2. GL 749020 absent from central group mapping

Three monthly EUR 60,000 IC consulting-income rows use GL `749020`.

The IC structure explicitly identifies that NannyML account and relationship, so the adapter uses:

`Mapping_Source = IC_STRUCTURE_OVERRIDE`

and surfaces:

`ACCOUNT_NOT_IN_GROUP_MAPPING`

as a warning.

The rows are classified as intercompany with `SODA_DATA_NV`, so they do not feed external revenue.

### 3. Missing June management fee

The IC schedule expects a EUR 23,000 monthly management fee from Soda Data NV to NannyML.

NannyML books EUR 23,000 in April and May but no June management-fee P&L row.

The June `416091` TB-derived movement increases by EUR 23,000 rather than remaining flat, which is consistent with the missing IC offset.

The script surfaces:

`IC_MISMATCH`

on the June derived current-account row without inventing or plugging the missing entry.

## Expected first Adsolut refresh

With the supplied pack, expect approximately:

```text
Source rows normalized: 173
New rows appended: 173
Existing rows skipped: 0
FAIL rows: 1
WARNING rows: 5
P&L/TB mismatches: 0
IC mismatch months: 1
Duplicate groups: 1
Excluded duplicate rows: 1
Future-dated rows: 0
Unmapped rows: 0
```

The five warning-status rows are expected to consist of:

- 3 × GL 749020 mapping-override rows;
- 1 × first occurrence of the duplicate Halden transaction;
- 1 × June 416091 IC mismatch row.

The second duplicate is a FAIL because it is deliberately excluded from metrics.

## Idempotency test

Run `Refresh NannyML / Adsolut data` a second time without changing source files.

Expected:

```text
New rows appended: 0
Existing rows skipped: 173
```

## Existing validated adapters

### Exact Online

Expected current population:

- 525 normalized rows;
- 6 future-dated FAIL rows;
- second identical refresh appends 0.

### QuickBooks

Expected current population:

- 231 normalized rows;
- 0 FAIL;
- 2 WARNING rows from the June USD 3,750 IC recharge mismatch;
- second identical refresh appends 0.

## Repository

Keep these files under:

```text
apps-script/
├── Code.gs
├── Config.gs
├── Importers.gs
├── Normalize.gs
├── Validation.gs
├── appsscript.json
└── README.md
```

Do not commit the source `.xlsx` files.


## Final monthly workflow

1. Upload the latest untouched source exports to the private source folder.
2. In the workbook choose `Soda Finance -> Refresh monthly data`.
3. The script refreshes Exact Online, QuickBooks and Adsolut in sequence.
4. Record-ID idempotency prevents previously imported rows from being appended again.
5. `Components` and `Dashboard` update automatically because they are formula-driven from `Data`.
6. Workbook protections are re-applied after every refresh so newly populated `Data` rows become locked and only the remaining blank append area stays editable.

No drag, fill-right, chart repointing or manual formula extension is required.

## Workbook protections

`Apply workbook protections` enforces the intended operating model:

- `Data`: all populated rows protected; future blank append rows remain editable.
- `Definitions`: protected.
- `Components`: protected.
- `Dashboard`: protected except the selected-month input `D3:F3`.
- protection editors are restricted to the effective script user; ordinary workbook collaborators can use only the intended editable ranges.

The same protection refresh also runs automatically after `Refresh monthly data`.
