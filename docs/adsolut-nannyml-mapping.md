# Adsolut / NannyML Source-to-Normalized Mapping

This document defines the ingestion contract for NannyML NV source files exported from Adsolut into the normalized `Data` layer used by the Track B SaaS metrics workbook.

The design deliberately distinguishes detailed P&L journal lines from balance-sheet movements derived from successive trial-balance snapshots.

---

# 1. Source Files

The Adsolut adapter uses:

1. `NannyML_NV - PL transactions by cost centre - Apr-Jun 2026 (Adsolut).xlsx`
2. `NannyML_NV - Trial balance - 31-03-2026 (Adsolut).xlsx`
3. `NannyML_NV - Trial balance - 30-04-2026 (Adsolut).xlsx`
4. `NannyML_NV - Trial balance - 31-05-2026 (Adsolut).xlsx`
5. `NannyML_NV - Trial balance - 30-06-2026 (Adsolut).xlsx`
6. `Soda_Group - Mapping.xlsx`
7. `Soda_Group - Structure IC and FX.xlsx`

Entity:

`NANNYML_NV`

Source system:

`ADSOLUT`

Book currency:

`EUR`

---

# 2. P&L Transaction Layout

The analytical P&L export contains 16 columns:

| Position | Source field | Normalized field |
|---:|---|---|
| A | `Number` | provenance only |
| B | `Period` | validation input |
| C | `Date` | `Transaction_Date` |
| D | `Invoice number` | `Document_Number` |
| E | `Journal` | `Journal` |
| F | `Description` | `Description` |
| G | `Supplier` | `Counterparty` |
| H | `Debit` | `Debit_Local` |
| I | `Credit` | `Credit_Local` |
| J | `Cost centre` | `Source_Cost_Centre` |
| K | `Cost unit` | not required currently |
| L | `GL account` | `Account_Code` |
| M | `GL account name` | `Account_Name` |
| N | `Amount` | `Transaction_Amount` and validation |
| O | `Currency` | `Transaction_Currency` |
| P | `Amount EUR` | `Amount_EUR` and validation |

Current P&L population:

`93 journal lines`

All current rows satisfy:

`Debit - Credit = Amount = Amount EUR`

and all current period/date combinations are internally consistent:

- April = Period 1
- May = Period 2
- June = Period 3

---

# 3. P&L Normalization

Every valid analytical P&L row becomes:

```text
Record_Type          = JOURNAL_LINE
Entity               = NANNYML_NV
Source_System        = ADSOLUT
Signed_Local         = Debit_Local - Credit_Local
Local_Currency       = EUR
Transaction_Currency = source Currency
Transaction_Amount   = source Amount
FX_Rate              = 1
FX_Rate_Type         = NONE
Amount_EUR           = source Amount EUR
```

`Mapped_Cost_Centre` retains the detailed source cost centre where present.

---

# 4. Trial-Balance Structure

Each Adsolut trial balance uses worksheet:

`ads-balans`

Coded GL rows contain:

- GL code in column C;
- account name in column G;
- displayed balance in column I.

The 31-Mar-2026 opening snapshot contains:

`20 balance-sheet accounts`

Each Apr/May/Jun snapshot contains:

- the same 20 B/S accounts; and
- 20 year-to-date P&L accounts.

The trial balance is used both for independent P&L reconciliation and for balance-sheet movement derivation.

---

# 5. Trial-Balance Sign Conversion

Adsolut's displayed trial-balance amount is a presentation balance, not always the normalized debit-positive / credit-negative ledger sign.

The central group mapping's `Debit / Credit` field is therefore used to convert the source balance:

```text
If Normal_Balance = Debit:
    Signed_Balance = Source_TB_Balance

If Normal_Balance = Credit:
    Signed_Balance = -Source_TB_Balance
```

This also handles negative presentation balances such as carried-forward losses consistently.

---

# 6. Opening Balance

The 31-Mar-2026 B/S snapshot becomes:

`20 OPENING_BALANCE rows`

For each B/S account:

```text
Transaction_Date     = 2026-03-31
Period_Key           = 202603
Month                = 2026-03-01
Signed_Local         = signed 31-Mar TB balance
Debit_Local          = positive part of Signed_Local
Credit_Local         = absolute negative part of Signed_Local
Local_Currency       = EUR
Transaction_Currency = EUR
FX_Rate              = 1
FX_Rate_Type         = NONE
Amount_EUR           = Signed_Local
```

---

# 7. TB-Derived Balance-Sheet Movements

NannyML does not provide detailed balance-sheet journal exports.

Therefore monthly B/S movement is calculated from successive snapshots:

`Monthly Movement = Current Signed TB Balance - Previous Signed TB Balance`

The adapter emits one explicit movement row for every B/S account in every month, including zero movements.

Each derived row is labelled:

`Record_Type = TB_DERIVED_MOVEMENT`

This is intentionally different from an original journal line and must never be presented as source transaction-level detail.

Current population:

```text
April: 20 TB_DERIVED_MOVEMENT rows
May:   20 TB_DERIVED_MOVEMENT rows
June:  20 TB_DERIVED_MOVEMENT rows
```

Total:

`60 TB_DERIVED_MOVEMENT rows`

This makes zero deferred-income movements visible and traceable rather than relying on the absence of rows.

---

# 8. Expected Normalized Population

With the supplied source pack:

```text
20 OPENING_BALANCE
60 TB_DERIVED_MOVEMENT
93 JOURNAL_LINE
----------------------
173 normalized rows
```

---

# 9. P&L-to-Trial-Balance Reconciliation

For each monthly/YTD TB snapshot:

`Cumulative normalized P&L transactions through month-end`

are compared account-by-account against:

`signed P&L balances in the corresponding Adsolut TB`

Current result:

```text
April: all P&L accounts reconcile
May:   all P&L accounts reconcile
June:  all P&L accounts reconcile
```

This reconciliation deliberately uses the full source population, including the source duplicate, because the duplicate is also reflected in the books and trial balance.

Metric eligibility is handled separately.

---

# 10. Mapping Override — GL 749020

The P&L source and trial balance use:

`749020 — Miscellaneous operating income - recharges Soda Data NV`

This account is absent from the central group mapping.

However, the supplied group-structure workbook explicitly identifies it as NannyML's intercompany income account for monthly data-science consulting invoiced to Soda Data NV.

Therefore the adapter applies a documented override:

```text
BS_PL             = PL
Normal_Balance    = Credit
Mapping_Source    = IC_STRUCTURE_OVERRIDE
Is_Intercompany   = TRUE
IC_Counterparty   = SODA_DATA_NV
```

The row remains visibly flagged:

`ACCOUNT_NOT_IN_GROUP_MAPPING`

with:

`Validation_Status = WARNING`

The three current monthly rows are not external customer revenue.

No unsupported reporting-layer values are invented for the missing central mapping.

---

# 11. Exact Duplicate — Halden IT Consulting

The source contains an exact duplicate in June:

```text
Period:          3
Date:            30-Jun-2026
Invoice:         26700012
Supplier:        Halden IT Consulting
GL:              602000
Cost centre:     Engineering
Amount:          EUR 12,526.92
```

The row appears twice with the same stable economic/source fields.

The June trial balance includes both copies, which proves the duplicate propagated into the source books.

Treatment:

- retain both rows in `Data`;
- set `Is_Duplicate = TRUE` on both;
- first occurrence remains visible and metric-eligible with `DUPLICATE_SOURCE_RECORD`;
- second occurrence receives `DUPLICATE_SOURCE_RECORD;DUPLICATE_EXCLUDED`;
- second occurrence has `Validation_Status = FAIL`;
- second occurrence has `Include_In_Metrics = FALSE`.

This corrects the investor-metric layer without deleting or rewriting the accounting source.

---

# 12. Intercompany Controls

The group schedule expects NannyML / Soda Data NV activity each month:

- NannyML invoices Soda Data NV EUR 60,000 for data-science consulting;
- Soda Data NV charges NannyML EUR 23,000 management fee;
- Soda Data NV pays the EUR 37,000 net current-account balance.

The expected net monthly movement in NannyML account `416091` is therefore:

`+60,000 - 23,000 - 37,000 = 0`

## April

- consulting income: EUR 60,000
- management fee: EUR 23,000
- derived `416091` movement: EUR 0

Result:

`PASS`

## May

- consulting income: EUR 60,000
- management fee: EUR 23,000
- derived `416091` movement: EUR 0

Result:

`PASS`

## June

- consulting income: EUR 60,000
- management fee booked from Soda Data NV: EUR 0
- expected management fee: EUR 23,000
- derived `416091` movement: +EUR 23,000

Result:

`IC_MISMATCH`

The +EUR 23,000 current-account movement is consistent with the missing management-fee offset.

The script flags the June derived `416091` row but does not create a synthetic EUR 23,000 expense or plug the books.

---

# 13. Metric Classifications

## External / recurring revenue

External `704000 Services` rows qualify as external and recurring revenue when not intercompany.

`749020` is intercompany income and is excluded.

## COGS subcontractors

External `602000` rows qualify where the source cost centre is:

- Engineering; or
- Product.

The duplicated Halden row would qualify as COGS, which is why the second duplicate is explicitly excluded from metrics.

## Cloud COGS

For GL `613200`, only approved production/cloud suppliers qualify.

Current NannyML examples:

- Google Cloud EMEA → include;
- Webflow → exclude;
- Notion Labs Inc. → exclude.

## Sales & Marketing spend

External P&L expense rows with source cost centre:

- Sales; or
- Marketing

qualify for S&M spend.

## Deferred income

`493010` is classified as deferred income.

Its balance is EUR 6,800 at 31-Mar, 30-Apr, 31-May and 30-Jun, so:

```text
April deferred-income movement = 0
May deferred-income movement   = 0
June deferred-income movement  = 0
```

The zero TB-derived movement rows remain visible in `Data`.

---

# 14. Expected First Refresh

With the supplied pack:

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

Expected warning-status rows:

- three GL 749020 mapping-override records;
- first Halden duplicate occurrence;
- June 416091 IC mismatch.

Expected FAIL:

- second Halden duplicate occurrence.

---

# 15. Idempotency

An identical second refresh must produce:

```text
New rows appended: 0
Existing rows skipped: 173
```

No source row may be duplicated in the normalized `Data` layer merely because the cumulative source files were reprocessed.

---

# 16. Acceptance Criteria

The Adsolut adapter is complete when:

1. the exact 16-column P&L schema is validated;
2. all P&L amount and period/date controls pass except documented issues;
3. all 20 opening B/S accounts are normalized;
4. all 60 Apr-Jun B/S derived movements are explicit;
5. cumulative P&L lines reconcile account-by-account to each monthly/YTD TB;
6. GL 749020 is resolved through a visible IC-structure override;
7. the Halden duplicate remains visible and only its second occurrence is excluded from metrics;
8. the June EUR 23,000 IC issue is surfaced without a synthetic plug;
9. `493010` zero movements remain traceable;
10. the same source pack can be rerun without appending duplicate normalized rows.
