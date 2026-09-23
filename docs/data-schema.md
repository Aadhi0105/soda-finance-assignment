# Normalized Data Schema

This document defines the normalized `Data` layer for the Soda Data Track B SaaS metrics workbook.

The objective is to transform source data from Exact Online, QuickBooks Online and Adsolut into one consistent, append-only structure that can support:

- Gross Margin %
- CAC Payback Period
- Calculated Billings
- future SaaS metrics added to the workbook
- deterministic validation
- source-to-output auditability
- repeatable monthly imports

The schema is intentionally wider than the minimum required for calculation because the `Data` tab is also the audit layer.

---

# 1. Design Principles

## 1.1 Preserve source provenance

Every normalized row must remain traceable to:

- the source entity,
- accounting system,
- source file,
- source record or row,
- import batch.

Normalization may add fields and classifications but must not destroy source provenance.

---

## 1.2 Append-only history

The normalized Data layer is append-only.

Historical records should not be overwritten merely because a later cumulative export contains the same transactions.

Monthly refreshes must identify records already imported and append only genuinely new records.

---

## 1.3 No silent correction

A suspicious source record must not disappear from the normalized dataset.

A problematic record may be:

- retained and included,
- retained and excluded,
- corrected with documented evidence,
- flagged for review.

The original record remains traceable in every case.

---

## 1.4 Deterministic calculations

Core accounting transformations, FX translation, classification and metric calculations must be deterministic.

The recurring calculation pipeline must not depend on probabilistic AI output.

---

## 1.5 One normalized schema across all systems

Source-specific adapters will convert:

- Exact Online,
- QuickBooks Online,
- Adsolut P&L transactions,
- Adsolut trial-balance movements

into the same normalized row structure.

Downstream metric logic must not depend on the originating accounting system.

---

# 2. Sign Convention

The normalized accounting sign convention is:

> Debit = positive  
> Credit = negative

Therefore:

`Signed_Local = Debit_Local - Credit_Local`

Examples:

- €10,000 expense debit → `+10000`
- €10,000 revenue credit → `-10000`
- €10,000 deferred-income credit → `-10000`

The normalized ledger retains accounting signs.

Presentation formulas in `Components` may reverse signs where a positive management-reporting value is clearer, for example external revenue.

The ingestion layer must not reverse accounting signs merely for presentation.

---

# 3. Normalized Data Columns

The Google Sheets `Data` tab will use the following logical schema.

---

## 3.1 Provenance

### `Record_ID`

Unique identifier for one normalized row.

Constructed deterministically from:

`Record_Fingerprint + Duplicate_Occurrence`

The same source data imported twice must produce the same `Record_ID`.

---

### `Record_Fingerprint`

Deterministic hash representing the economic/source identity of a record.

The fingerprint should use stable source attributes where available, including:

- Entity
- Source_System
- Transaction_Date
- Document_Number / Entry_Number
- Account_Code
- Counterparty
- Description
- Debit_Local
- Credit_Local
- Source_Cost_Centre

`Source_Row` must not be part of the permanent fingerprint because row positions may change in cumulative exports.

---

### `Duplicate_Occurrence`

Sequential occurrence number for rows sharing the same `Record_Fingerprint`.

Examples:

- first occurrence → `1`
- second identical occurrence → `2`

This allows genuine source duplicates to remain visible rather than being silently removed.

---

### `Import_Batch_ID`

Unique identifier for the monthly import execution that created the normalized row.

Recommended format:

`YYYYMMDD-HHMMSS`

or an equivalent deterministic batch identifier.

---

### `Imported_At`

Timestamp recording when the normalized row was imported.

Used for auditability only.

It must not drive financial calculations.

---

### `Source_File`

Original source filename.

Example:

`Soda_Data_NV - Transactions FY27 PL accounts - to 30-06-2026 (Exact Online).xlsx`

---

### `Source_System`

Allowed values:

- `EXACT`
- `QUICKBOOKS`
- `ADSOLUT`

---

### `Source_Row`

Original row number or equivalent source-row locator.

Used only for provenance and debugging.

It is not a permanent record identifier.

---

### `Entity`

Allowed values:

- `SODA_DATA_NV`
- `SODA_DATA_INC`
- `NANNYML_NV`

---

### `Record_Type`

Allowed values initially:

- `JOURNAL_LINE`
- `OPENING_BALANCE`
- `TB_DERIVED_MOVEMENT`

A future `ADJUSTMENT` type may be introduced only if a documented use case requires it.

`TB_DERIVED_MOVEMENT` must be used when a monthly balance-sheet movement is derived from successive trial-balance snapshots rather than supplied as an original journal line.

---

# 4. Transaction Fields

### `Transaction_Date`

True spreadsheet date representing the accounting date of the record.

Text-formatted dates must be parsed during import.

Invalid dates must fail validation.

---

### `Period_Key`

Six-digit accounting period key:

`YYYYMM`

Examples:

- April 2026 → `202604`
- May 2026 → `202605`
- June 2026 → `202606`

Used for deterministic formulas and filtering.

---

### `Month`

True spreadsheet date representing the normalized reporting month.

Use the first day of the month consistently.

Examples:

- `2026-04-01`
- `2026-05-01`
- `2026-06-01`

The display format may be `MMM-YY`.

---

### `Document_Number`

Invoice number, journal entry number, transaction number or closest available source identifier.

May be blank where the source does not provide one.

---

### `Journal`

Source journal, transaction type or equivalent accounting category where available.

May be blank where not applicable.

---

### `Counterparty`

Supplier, customer, employee, group company or other counterparty supplied by the accounting source.

Source value should be preserved.

---

### `Description`

Original accounting description or memo.

Source wording should be preserved where practicable.

---

# 5. Accounting Fields

### `Account_Code`

Original GL account code as text.

Account codes must not be converted to numeric values if doing so could remove leading zeroes.

---

### `Account_Name`

Original source account name.

---

### `Source_Cost_Centre`

Cost centre exactly as supplied in the accounting export.

May be blank where the source does not provide analytical coding.

---

### `Debit_Local`

Debit amount in the entity's local currency.

Positive numeric value or zero.

---

### `Credit_Local`

Credit amount in the entity's local currency.

Positive numeric value or zero.

---

### `Signed_Local`

Normalized accounting amount:

`Debit_Local - Credit_Local`

Debit balances are positive.

Credit balances are negative.

---

### `Local_Currency`

Allowed values initially:

- `EUR`
- `USD`

Expected entity currencies:

- Soda Data NV → EUR
- Soda Data Inc → USD
- NannyML NV → EUR

Any unexpected currency must produce a validation flag.

---

# 6. Mapping and FX Fields

### `Reporting_L1`

Highest reporting layer supplied by the Soda group mapping.

---

### `Reporting_L2`

Second reporting layer supplied by the Soda group mapping.

---

### `Reporting_L3`

Third reporting layer where available.

Blank if the mapping does not provide a third layer.

---

### `Mapped_Cost_Centre`

Normalized cost-centre classification after applying the group mapping and documented overrides.

This field may differ from `Source_Cost_Centre` where a mapping rule requires normalization.

---

### `BS_PL`

Allowed values:

- `BS`
- `PL`

Derived from the supplied group mapping or an explicitly documented override.

---

### `Account_Type`

Account classification supplied by the mapping.

Examples may include:

- Revenue
- Personnel
- Subcontractors
- Software
- Deferred Income
- Other classifications present in the supplied mapping.

Source mapping terminology should be preserved.

---

### `FX_Rate`

EUR/USD rate applied to the normalized row.

For EUR records:

`FX_Rate = 1`

For USD records, use the appropriate supplied monthly rate.

---

### `FX_Rate_Type`

Allowed values:

- `NONE`
- `AVERAGE`
- `CLOSING`

`NONE` applies to EUR-denominated rows.

`AVERAGE` is used for monthly P&L and flow translation.

`CLOSING` is used where a month-end balance-sheet balance is translated for reconciliation.

---

### `Amount_EUR`

EUR-normalized accounting amount.

For EUR rows:

`Amount_EUR = Signed_Local`

For USD flows:

`Amount_EUR = Signed_Local / FX_Rate`

assuming the supplied FX table is expressed as USD per EUR.

The precise direction of every imported FX rate must be validated against the supplied FX workbook before implementation.

---

### `Mapping_Source`

Explains how account classification was obtained.

Allowed values initially:

- `GROUP_MAPPING`
- `IC_STRUCTURE_OVERRIDE`
- `MANUAL_DOCUMENTED_OVERRIDE`
- `UNMAPPED`

This field ensures that overrides are visible rather than silently embedded in code.

---

# 7. Metric Classification Fields

These fields are deterministic Boolean classifications used by `Components`.

They must be derived from explicit rules rather than manual cell edits.

---

### `Is_Intercompany`

`TRUE` when the transaction represents activity between group entities.

Identification should use the supplied intercompany structure and documented account/counterparty rules.

Otherwise:

`FALSE`

---

### `IC_Counterparty`

Normalized group counterparty where `Is_Intercompany = TRUE`.

Allowed values where applicable:

- `SODA_DATA_NV`
- `SODA_DATA_INC`
- `NANNYML_NV`

Blank for external transactions.

---

### `Is_External_Revenue`

`TRUE` when:

- the row is revenue,
- GL belongs to the approved external customer revenue scope,
- the row is not intercompany,
- the row passes the required metric validations.

Current revenue-account scope:

- `704000`
- `704001`
- `704002`

---

### `Is_Recurring_Revenue`

`TRUE` when:

- GL = `704000` or `704001`,
- the row represents external customer revenue,
- the row is not intercompany.

`704002` Forward Deploying Engineers is excluded from recurring revenue for CAC purposes.

---

### `Is_COGS_Subcontractor`

`TRUE` when:

- Reporting Layer 2 = Subcontractors,
- normalized cost centre = Engineering or Product,
- counterparty is external,
- row represents an expense,
- validation permits metric inclusion.

---

### `Is_COGS_Cloud`

`TRUE` when:

- GL = `613200`,
- supplier appears in the approved production/cloud supplier classification,
- row represents an external expense.

The approved supplier classification must remain visible in the workbook rather than being hidden only inside Apps Script.

---

### `Is_SM_Spend`

`TRUE` when:

- row is a P&L expense,
- normalized cost centre = Sales or Marketing,
- counterparty is external,
- row passes metric validation.

Corporate overhead cost centres are excluded.

---

### `Is_Deferred_Income`

`TRUE` when:

`Account_Code = 493010`

This applies across all three entities.

---

# 8. Validation Fields

### `Is_Duplicate`

`TRUE` when more than one source row has the same `Record_Fingerprint`.

A duplicate must remain visible in `Data`.

Duplicate detection must not automatically delete source rows.

---

### `Is_Unmapped`

`TRUE` where an account cannot be classified through:

- the group mapping, or
- an approved documented override.

---

### `Is_Future_Dated`

`TRUE` where the transaction date falls outside the source file's valid reporting cutoff or current import scope.

Future-dated rows remain visible but should not feed current-period metrics.

---

### `Validation_Status`

Allowed values:

- `PASS`
- `WARNING`
- `FAIL`

#### PASS

No identified issue affecting processing or metric eligibility.

#### WARNING

A documented issue or override exists, but the record may still be suitable for metric calculations.

Examples:

- classification derived from an explicit IC-structure override,
- non-standard but explainable source condition.

#### FAIL

The record must not feed metrics until resolved or explicitly corrected.

Examples:

- invalid date,
- unresolved mapping,
- confirmed duplicate selected for exclusion,
- missing required amount,
- missing required FX rate,
- out-of-scope future transaction.

---

### `Issue_Codes`

Semicolon-separated deterministic issue codes.

Examples:

- `DUPLICATE_SOURCE_RECORD`
- `UNMAPPED_ACCOUNT`
- `FUTURE_DATED`
- `MISSING_FX_RATE`
- `INVALID_DATE`
- `IC_MISMATCH`
- `MISSING_REQUIRED_FIELD`

A row may contain more than one issue code.

---

### `Include_In_Metrics`

Boolean control determining whether a normalized row is eligible for metric calculations.

Important:

`Validation_Status` and `Include_In_Metrics` are separate concepts.

For example:

- `WARNING` may still have `Include_In_Metrics = TRUE`
- `FAIL` will normally have `Include_In_Metrics = FALSE`

Metric formulas must explicitly filter on:

`Include_In_Metrics = TRUE`

---

# 9. Record Identity and Idempotency

The monthly import must be safe to rerun.

A cumulative accounting export may contain transactions imported during previous months.

Therefore the script must not identify records solely by:

- source filename,
- row number,
- import timestamp.

The import process should:

1. normalize the source record,
2. construct `Record_Fingerprint`,
3. determine `Duplicate_Occurrence`,
4. construct `Record_ID`,
5. compare the resulting `Record_ID` against existing Data,
6. append only records not already present.

An identical rerun of the same source files must append zero new records.

---

# 10. Duplicate Handling

Duplicate detection and import idempotency are different controls.

An exact duplicate in the source may be a genuine accounting/data-quality issue.

Therefore:

- identical source rows must remain visible,
- the second occurrence must not be silently discarded,
- each occurrence receives a separate `Record_ID`,
- duplicate rows receive `Is_Duplicate = TRUE`,
- treatment for metric purposes is determined explicitly.

Example:

`Record_Fingerprint = ABC123`

may produce:

- `ABC123 + occurrence 1`
- `ABC123 + occurrence 2`

The normalized dataset preserves both.

---

# 11. Source Adapters

Each accounting source will have its own ingestion adapter.

## Exact Online

Expected function:

`normalizeExactRow()`

Responsibilities:

- parse Exact export fields,
- retain Entry Number and source metadata,
- normalize debit/credit values,
- assign Soda Data NV,
- derive period/date fields,
- pass normalized rows to common mapping and validation logic.

---

## QuickBooks Online

Expected function:

`normalizeQuickBooksRow()`

Responsibilities:

- parse QuickBooks general-ledger layout,
- distinguish beginning-balance rows from journal lines,
- assign Soda Data Inc,
- normalize USD amounts,
- retain transaction/document identifiers,
- pass normalized rows to common mapping and validation logic.

---

## Adsolut P&L

Expected function:

`normalizeAdsolutPLRow()`

Responsibilities:

- parse analytical P&L transactions,
- map Adsolut period numbers to reporting months,
- preserve cost-centre detail,
- assign NannyML NV,
- pass normalized rows to common mapping and validation logic.

---

## Adsolut Trial Balance

Expected function:

`deriveAdsolutTBMovement()`

Responsibilities:

- compare successive trial-balance snapshots,
- derive monthly balance-sheet movement only where transaction-level B/S data is unavailable,
- assign `Record_Type = TB_DERIVED_MOVEMENT`,
- preserve both source snapshots in provenance metadata where practicable,
- prevent derived movements from being misrepresented as original journal entries.

---

# 12. Control Architecture

Validation occurs at multiple levels.

---

## 12.1 Import / Schema Controls

Each source import must verify:

- expected headers exist,
- required columns are present,
- entity and source system are recognized,
- accounting dates parse correctly,
- monetary fields are numeric,
- source file is not malformed.

Unexpected schema changes should fail loudly rather than being guessed.

---

## 12.2 Row-Level Controls

Each normalized row should be tested for:

- duplicate fingerprint,
- missing account,
- missing mapping,
- invalid date,
- future/out-of-scope date,
- unexpected currency,
- missing FX rate,
- missing required values.

---

## 12.3 Source Reconciliations

### Soda Data NV

The Exact P&L and balance-sheet exports form opposite sides of journal entries.

Where applicable:

`Sum of Signed_Local by Entry Number = 0`

Any non-zero journal must be surfaced.

---

### Soda Data Inc

Reconstruct closing account balances from:

`Opening Balance + Debits - Credits`

and compare against the supplied 30 June QuickBooks trial balance.

Differences must be visible.

---

### NannyML NV

Aggregate analytical P&L transactions through each month and compare the result to the corresponding year-to-date trial-balance P&L balances.

Differences must be visible.

---

## 12.4 Mapping Controls

Metric-eligible records must not contain unresolved mappings.

Required control:

`Count of Include_In_Metrics = TRUE AND Is_Unmapped = TRUE`

must equal zero.

Approved overrides remain visible through `Mapping_Source`.

---

## 12.5 Intercompany Controls

Expected group relationships must be checked month by month.

The control should compare both recorded sides of each intercompany relationship after appropriate currency translation.

Any residual must remain visible and must not be silently plugged.

---

## 12.6 Metric Controls

Every row included in a metric must satisfy the relevant classification and validation conditions.

Examples:

- intercompany revenue must never feed external revenue,
- excluded duplicates must never feed Components,
- every USD metric row must have an applicable FX rate,
- every metric-eligible account must have a valid mapping.

The final metric calculations remain in `Components`, not inside Apps Script.

---

# 13. Audit Trail

The required audit chain is:

`Dashboard → Components → Data`

Apps Script performs ingestion and classification but does not hide the metric calculation logic.

A reviewer should be able to:

1. select a Dashboard metric,
2. trace it to its Component rows,
3. inspect the visible criteria used by those rows,
4. trace the included values to normalized Data records,
5. identify the original source file and source row.

---

# 14. Current Known Source Exceptions

Known source issues will not be hard-coded into this schema document as permanent business logic.

They will be handled through:

- deterministic validation where possible,
- explicit issue codes,
- documented overrides where justified,
- the separate assignment write-up.

This prevents one-off source defects from becoming permanent calculation rules.

---

# 15. Implementation Rule

No Apps Script importer should be considered complete until its output conforms to this schema and passes the applicable validation controls.

Changes to this schema after implementation begins must be recorded as an explicit design decision rather than introduced silently.