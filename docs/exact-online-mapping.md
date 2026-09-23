# Exact Online Source-to-Normalized Mapping

This document defines the Phase A mapping contract for Soda Data NV source files exported from Exact Online into the normalized `Data` layer used by the Track B SaaS metrics workbook.

The objective is to make the ingestion implementation deterministic, auditable and testable before any Apps Script importer is written.

---

# 1. Source Files

The Exact Online adapter covers three Soda Data NV files:

1. `Soda_Data_NV - Opening balance sheet - 31-03-2026 (Exact Online).xlsx`
2. `Soda_Data_NV - Transactions FY27 balance sheet accounts - to 30-06-2026 (Exact Online).xlsx`
3. `Soda_Data_NV - Transactions FY27 PL accounts - to 30-06-2026 (Exact Online).xlsx`

Entity:

`SODA_DATA_NV`

Source system:

`EXACT`

Book currency:

`EUR`

The two FY27 transaction exports share the same 25-column source layout.

---

# 2. Opening Balance Sheet

## 2.1 Source row selection

The opening-balance file contains headings and totals in addition to account balances.

Only rows whose account label matches the pattern below should be treated as GL-account rows:

`^\d{6}\s*-\s*...`

Examples of rows that must not be imported as account records include:

- Assets
- Equity and liabilities
- Total
- other section headings or totals

---

## 2.2 Opening-balance mapping

Each valid GL-account row becomes one normalized row with:

- `Record_Type = OPENING_BALANCE`
- `Entity = SODA_DATA_NV`
- `Source_System = EXACT`
- `Transaction_Date = 2026-03-31`
- `Period_Key = 202603`
- `Month = 2026-03-01`
- `Account_Code = first six digits of the account label`
- `Account_Name = text following " - "`
- `Debit_Local = source closing debit balance`
- `Credit_Local = source closing credit balance`
- `Signed_Local = Debit_Local - Credit_Local`
- `Local_Currency = EUR`
- `Transaction_Currency = EUR`
- `Transaction_Amount = Signed_Local`
- `FX_Rate = 1`
- `FX_Rate_Type = NONE`
- `Amount_EUR = Signed_Local`

The following fields remain blank when the source does not provide them:

- `Document_Number`
- `Journal`
- `Counterparty`
- `Source_Cost_Centre`

Values must not be invented solely to fill the normalized schema.

---

# 3. FY27 Transaction Export Contract

The Balance Sheet and P&L transaction exports both use the same 25-column Exact layout.

Because the export contains repeated header names, the importer must validate the full expected header sequence and then use fixed positional constants.

The importer must not create a lookup keyed only on header text.

---

# 4. Exact Transaction Field Mapping

| Position | Exact source field | Normalized field | Treatment |
|---:|---|---|---|
| A | `No.` | — | Source display/order only; do not use as permanent identity |
| B | `Per.` | — | Fiscal-period validation input |
| C | `Date` | `Transaction_Date` | Parse as a real date |
| D | `Entry no.` | `Document_Number` | Preserve as text |
| E | `Journal` | `Journal` | Preserve |
| F | `Description` | `Description` | Preserve |
| G | `Account` | `Counterparty` | Preserve |
| H | `Debit` | `Debit_Local` | EUR book value |
| I | `Credit` | `Credit_Local` | EUR book value |
| J | `Cost centre` | `Source_Cost_Centre` | Preserve |
| K | `Cost unit` | — | Currently not required |
| L | first `G/L Account` | `Account_Code` | Preserve as text |
| M | second `G/L Account` | `Account_Name` | Preserve source name |
| N | first `Amount` | validation only | Must equal `Debit_Local - Credit_Local` |
| O | first `Cur.` | `Transaction_Currency` | Original transaction currency |
| P | second `Amount` | `Transaction_Amount` | Signed original-currency amount |
| Q | `Your ref.` | — | Not required currently |
| R | `Matched` | — | Not required currently |
| S | next `Amount` | — | Not required currently |
| T | `VAT %` | — | Not required currently |
| U | `VAT` | — | Not required currently |
| V | `Account: Country` | — | Not required currently |
| W | second `Cur.` | validation only | May duplicate transaction currency |
| X | final `Amount` | validation only | May duplicate original-currency amount |
| Y | `Account: VAT number` | — | Not required currently |

---

# 5. Positional Constants

The Apps Script implementation should validate the entire source header sequence before using positional constants.

Illustrative zero-based positions:

```javascript
const EXACT = {
  PERIOD: 1,
  DATE: 2,
  ENTRY_NO: 3,
  JOURNAL: 4,
  DESCRIPTION: 5,
  COUNTERPARTY: 6,
  DEBIT: 7,
  CREDIT: 8,
  COST_CENTRE: 9,
  GL_CODE: 11,
  GL_NAME: 12,
  BASE_AMOUNT: 13,
  TRANSACTION_CURRENCY: 14,
  TRANSACTION_AMOUNT: 15
};
```

If the expected 25-column structure changes, the import should fail with a schema error rather than infer a new layout.

---

# 6. Derived Fields for Transaction Rows

For all imported Exact transaction rows:

- `Record_Type = JOURNAL_LINE`
- `Entity = SODA_DATA_NV`
- `Source_System = EXACT`
- `Local_Currency = EUR`
- `Signed_Local = Debit_Local - Credit_Local`
- `Period_Key = YYYYMM(Transaction_Date)`
- `Month = first day of Transaction_Date month`
- `FX_Rate = 1`
- `FX_Rate_Type = NONE`
- `Amount_EUR = Signed_Local`

`Transaction_Currency` and `Transaction_Amount` preserve the original-currency information supplied by Exact.

---

# 7. Book Currency vs Transaction Currency

Soda Data NV books in EUR.

Therefore:

- `Local_Currency = EUR` for all Soda Data NV Exact rows.
- `Signed_Local` is the EUR book value.
- `Amount_EUR = Signed_Local`.

Some Exact rows are denominated in USD and additionally provide:

- `Transaction_Currency = USD`
- `Transaction_Amount = signed USD amount`

These rows must not be FX-translated a second time.

Example logic:

```text
EUR book value       = 25,000
Transaction currency = USD
Transaction amount   = 28,750

Local_Currency       = EUR
Signed_Local         = 25,000
Amount_EUR           = 25,000
Transaction_Currency = USD
Transaction_Amount   = 28,750
```

The original-currency fields remain useful for intercompany reconciliation.

---

# 8. Group Mapping

The Exact adapter should enrich each row using the supplied Soda group mapping.

Populate:

- `Reporting_L1`
- `Reporting_L2`
- `Reporting_L3`
- `Reporting_L4`
- `BS_PL`
- `Account_Type`
- `Normal_Balance`
- `Mapping_Classification`
- `Mapping_Source`

Where the regular group mapping is used:

`Mapping_Source = GROUP_MAPPING`

---

# 9. Cost Centre Treatment

For Exact transaction rows:

`Mapped_Cost_Centre = cleaned Source_Cost_Centre`

The mapping workbook's cost-centre field should be treated as a classification or validation expectation rather than blindly replacing the transaction-level source cost centre.

This is important where one account is valid across several operational cost centres.

Example:

A payroll account may be mapped broadly while source transactions legitimately carry specific cost centres such as:

- Sales
- Marketing
- Engineering
- Product
- Management
- People
- Operations

The detailed source cost centre must be retained because Track B uses it for metric classification.

---

# 10. Exact-Specific Validation Rules

## 10.1 Schema validation

The complete expected 25-column Exact transaction header sequence must match.

Failure code:

`EXACT_SCHEMA_MISMATCH`

The import must stop for that source file rather than guess a new layout.

---

## 10.2 Debit/Credit amount validation

For each transaction:

`Debit_Local - Credit_Local = source base Amount`

Mismatch issue code:

`EXACT_BASE_AMOUNT_MISMATCH`

---

## 10.3 Fiscal-period validation

FY27 runs April 2026 to March 2027.

Expected period mapping:

- April = Period 1
- May = Period 2
- June = Period 3
- July = Period 4
- August = Period 5
- September = Period 6
- October = Period 7
- November = Period 8
- December = Period 9
- January = Period 10
- February = Period 11
- March = Period 12

Mismatch issue code:

`EXACT_PERIOD_DATE_MISMATCH`

---

## 10.4 Opening-balance check

For the 31 March opening balance:

`SUM(Debit_Local - Credit_Local) = 0`

Failure code:

`EXACT_OPENING_BS_IMBALANCE`

---

## 10.5 Cross-file journal balancing

The P&L and Balance Sheet transaction exports contain different legs of the same journal entries.

For each Exact `Entry no.` across both files:

`SUM(Signed_Local) = 0`

A non-zero result must be surfaced.

Issue code:

`EXACT_ENTRY_IMBALANCE`

The importer must not require either file to balance independently.

---

## 10.6 Mapping completeness

Every metric-eligible Exact row must have a valid account mapping.

If no mapping or approved override is available:

- `Is_Unmapped = TRUE`
- `Validation_Status = FAIL`
- `Issue_Codes` includes `UNMAPPED_ACCOUNT`
- `Include_In_Metrics = FALSE`

---

## 10.7 Duplicate validation

Stable economic/source fields should be used to detect duplicate source rows.

A duplicate must remain visible in `Data`.

It must not be silently removed during import.

Issue code:

`DUPLICATE_SOURCE_RECORD`

---

# 11. Source Cutoff and Future-Dated Records

The importer must derive or read the source-file reporting cutoff and compare transaction dates against it.

A transaction dated after the stated source cutoff remains in `Data` but is excluded from current metrics.

Required treatment:

- `Is_Future_Dated = TRUE`
- `Validation_Status = FAIL`
- `Issue_Codes` includes `FUTURE_DATED`
- `Include_In_Metrics = FALSE`

The row must not be deleted.

---

# 12. Current Known Exact Exception

The current June source pack contains FY27 year-end true-up entries dated 31 March 2027 even though the transaction files are stated as being to 30 June 2026.

These entries are valid balancing accounting entries but are outside the source cutoff.

This means:

- journal balancing alone is not sufficient to validate the population;
- date/cutoff controls must run independently;
- the records remain in the normalized Data layer for auditability;
- they are excluded from April-June metric calculations.

The importer must detect this condition through general cutoff logic rather than a hard-coded description rule.

---

# 13. Acceptance Criteria for the Exact Adapter

The Exact ingestion layer is not complete until all of the following are true:

1. All three Exact source formats are parsed without manual row editing.
2. The full 25-column transaction schema is validated before normalization.
3. Opening-balance account rows are selected deterministically.
4. Debit/credit signs are normalized consistently.
5. Original transaction currency and amount are preserved.
6. EUR book values are not translated a second time.
7. Group mapping fields are populated.
8. Transaction-level source cost centres are retained.
9. Future-dated records are visible and excluded appropriately.
10. Exact journal entries reconcile across the P&L and B/S exports.
11. A rerun of the same source data does not duplicate normalized records.
12. All failures and warnings remain visible through the validation fields.
13. Downstream metric logic can operate entirely on the normalized `Data` schema without source-system-specific formulas.
