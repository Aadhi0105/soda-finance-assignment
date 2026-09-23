# Phase B — Exact Online Apps Script

This folder contains the first working ingestion layer for Track B.

It implements:

`Exact Online source files -> normalization -> group mapping -> validation -> idempotent append to Data`

## Source folder

A private Google Drive source folder has already been created:

https://drive.google.com/drive/folders/18WMrbaWxNdIT6-ZQL14YtjdTu5qoodOR

Upload the original candidate `.xlsx` files to that folder unchanged.

For the current Exact phase, the script requires at least:

- `Soda_Data_NV - Opening balance sheet - 31-03-2026 (Exact Online).xlsx`
- `Soda_Data_NV - Transactions FY27 balance sheet accounts - to 30-06-2026 (Exact Online).xlsx`
- `Soda_Data_NV - Transactions FY27 PL accounts - to 30-06-2026 (Exact Online).xlsx`
- `Soda_Group - Mapping.xlsx`

Uploading all 12 candidate spreadsheets now is fine and will save time for the later QuickBooks and Adsolut phases.

Do not rename or edit the raw source files.

## Install into the Google Sheet

Open:

https://docs.google.com/spreadsheets/d/1mmunZBcnGFvsTOqdCsKb7n7-GpUwE1qmdanJMK8n9zM/edit

Then:

1. `Extensions -> Apps Script`
2. Keep the project bound to this workbook.
3. Create these script files:
   - `Code.gs`
   - `Config.gs`
   - `Importers.gs`
   - `Normalize.gs`
   - `Validation.gs`
4. Paste the contents of the matching local files into each Apps Script file.
5. In Apps Script Project Settings, enable `Show "appsscript.json" manifest file in editor`.
6. Replace the manifest with the supplied `appsscript.json`.
7. Save all files.
8. Reload the Google Sheet.

A new menu should appear:

`Soda Finance`

with:

- `Validate setup`
- `Refresh Exact Online data`

## First test

Run:

`Soda Finance -> Validate setup`

The first run will ask for Google authorization.

If setup is valid, run:

`Soda Finance -> Refresh Exact Online data`

The script will:

1. locate the latest matching Exact files in the private Drive folder;
2. temporarily convert each `.xlsx` to a native Google Sheet;
3. read the source data;
4. trash the temporary conversions;
5. normalize all Exact rows into the 53-column Data schema;
6. apply the supplied group mapping;
7. run row-level and batch controls;
8. create stable SHA-256 record identities;
9. append only Record_IDs not already present.

## Important controls implemented

- exact 25-column Exact transaction schema validation;
- opening-balance row selection by six-digit GL code;
- `Debit - Credit = source base Amount`;
- FY27 Period-to-Date consistency;
- source cutoff vs transaction date;
- full group mapping;
- group mapping completeness;
- source duplicate flagging;
- Exact opening-balance check;
- Exact Entry No. balancing across the combined B/S and P&L files;
- book currency vs original transaction currency separation;
- prevention of double FX conversion for Soda Data NV;
- idempotent reruns.

## Expected behaviour with the supplied June pack

The current source pack contains:

- 27 opening-balance GL rows;
- 270 Exact balance-sheet transaction rows;
- 228 Exact P&L transaction rows.

That is 525 normalized source rows before idempotency.

The known 31 March 2027 year-end true-up consists of three balancing journal entries represented by six normalized journal lines across the B/S and P&L exports. Those lines should remain visible in `Data`, be flagged `FUTURE_DATED`, receive `Validation_Status = FAIL`, and have `Include_In_Metrics = FALSE`.

The Exact entries themselves should balance across the combined B/S and P&L exports, and the current Exact GL codes should map successfully.

## Rerun test

After a successful first refresh, run `Refresh Exact Online data` again with no source changes.

Expected result:

`New rows appended: 0`

This is the first idempotency test.

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

Do not commit the Soda source `.xlsx` files.
