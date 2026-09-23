# QuickBooks Online Source-to-Normalized Mapping

This document defines the Phase A mapping contract for Soda Data Inc. source files exported from QuickBooks Online into the normalized `Data` layer used by the Track B SaaS metrics workbook.

The objective is to make the QuickBooks ingestion implementation deterministic, auditable and testable before `normalizeQuickBooksRow()` is coded.

---

# 1. Source Files

The QuickBooks adapter covers two Soda Data Inc. files:

1. `Soda_Data_Inc - General ledger - Apr-Jun 2026 (QuickBooks).xlsx`
2. `Soda_Data_Inc - Trial balance - 30-06-2026 (QuickBooks).xlsx`

Reference files used by the adapter and controls:

3. `Soda_Group - Mapping.xlsx`
4. `Soda_Group - Structure IC and FX.xlsx`

Entity:

`SODA_DATA_INC`

Source system:

`QUICKBOOKS`

Book currency:

`USD`

The group-structure workbook confirms that Soda Data Inc. is the U.S. subsidiary, uses QuickBooks Online and has USD as its accounting currency.

---

# 2. General Ledger Source Structure

The General Ledger uses the following 10-column layout:

| Position | QuickBooks source field | Normalized field | Treatment |
|---:|---|---|---|
| A | `Account` | `Account_Code` | Preserve six-digit GL code as text |
| B | `Account name` | `Account_Name` | Preserve source account name |
| C | `Transaction date` | `Transaction_Date` | Parse for journal lines |
| D | `Transaction type` | `Journal` / `Record_Type` input | Preserve transaction type; `Beginning Balance` drives opening-balance handling |
| E | `Num` | `Document_Number` | Preserve where supplied; may be blank |
| F | `Name` | `Counterparty` | Preserve customer, supplier or group company |
| G | `Class` | `Source_Cost_Centre` | Preserve operational class/cost centre |
| H | `Description` | `Description` | Preserve source memo |
| I | `Debit` | `Debit_Local` | USD book value |
| J | `Credit` | `Credit_Local` | USD book value |

The General Ledger contains:

- 218 dated journal/transaction lines with valid six-digit GL codes;
- 30 coded `Beginning Balance` rows;
- of those 30 coded opening rows, 13 have a non-zero balance and 17 are zero-value account scaffolding;
- 3 additional zero-value `Beginning Balance` display rows without GL codes;
- one QuickBooks footer row.

---

# 3. Source Row Selection

## 3.1 Journal lines

Import every dated General Ledger row where:

- `Account` is a valid six-digit GL code; and
- `Transaction type != Beginning Balance`.

Each becomes:

`Record_Type = JOURNAL_LINE`

Current source population:

`218 rows`

---

## 3.2 Opening balances

Import a `Beginning Balance` row only where:

- `Account` is a valid six-digit GL code; and
- either Debit or Credit is non-zero.

Each becomes:

`Record_Type = OPENING_BALANCE`

Current source population:

`13 rows`

The 17 coded zero-value beginning-balance rows are structural QuickBooks account scaffolding rather than economic opening balances and are not required for reconstruction.

The three blank-code zero-value display rows are also skipped.

The QuickBooks footer is not a financial record and is skipped.

Therefore the current General Ledger is expected to produce:

`231 normalized rows = 13 opening balances + 218 journal lines`

---

# 4. Opening-Balance Treatment

The General Ledger covers April-June 2026 and the supplied trial balance states that the financial year runs April 2026-March 2027.

Therefore non-zero `Beginning Balance` rows represent the position immediately before FY27 activity and are normalized as:

```text
Record_Type          = OPENING_BALANCE
Entity               = SODA_DATA_INC
Source_System        = QUICKBOOKS
Transaction_Date     = 2026-03-31
Period_Key           = 202603
Month                = 2026-03-01
Local_Currency       = USD
Transaction_Currency = USD
Transaction_Amount   = Signed_Local
FX_Rate              = 1.1484
FX_Rate_Type         = CLOSING
Amount_EUR           = Signed_Local / 1.1484
```

The 31 March closing EUR/USD rate is supplied in the group FX workbook.

`Transaction_Date = 2026-03-31` is a controlled derivation from the fiscal-year boundary, not a date supplied directly on each Beginning Balance row.

---

# 5. Derived Fields for Journal Lines

For every valid dated QuickBooks row:

```text
Record_Type          = JOURNAL_LINE
Entity               = SODA_DATA_INC
Source_System        = QUICKBOOKS
Signed_Local         = Debit_Local - Credit_Local
Local_Currency       = USD
Transaction_Currency = USD
Transaction_Amount   = Signed_Local
Period_Key           = YYYYMM(Transaction_Date)
Month                = first day of Transaction_Date month
```

The QuickBooks export does not contain a separate transaction-currency column.

Therefore the normalized transaction currency remains USD, which is the book currency of Soda Data Inc.

The underlying EUR denomination of account `429011` must not be inferred into `Transaction_Currency`; that economic feature is captured through the account, IC structure and dedicated loan-revaluation control.

---

# 6. FX Treatment

The supplied FX workbook states:

`1 EUR = x USD`

Rates:

| Month | Average EUR/USD | Closing EUR/USD |
|---|---:|---:|
| Mar-26 | — | 1.1484 |
| Apr-26 | 1.1690 | 1.1645 |
| May-26 | 1.1680 | 1.1610 |
| Jun-26 | 1.1500 | 1.1394 |

## 6.1 Opening balances

Opening balance rows are balance-sheet positions and use the 31 March closing rate:

`Amount_EUR = Signed_Local / 1.1484`

`FX_Rate_Type = CLOSING`

---

## 6.2 Journal-line movements

Normalized journal rows represent monthly transaction flows.

For journal-line `Amount_EUR`, use the monthly average EUR/USD rate:

`Amount_EUR = Signed_Local / monthly average EUR/USD`

and:

`FX_Rate_Type = AVERAGE`

This applies to the normalized transaction-flow measure even when the journal line posts to a balance-sheet account.

This does **not** mean month-end balance-sheet balances are consolidated at average FX.

Month-end Soda Data Inc. balance-sheet controls must instead:

1. reconstruct the closing balance in USD from local books; then
2. translate that closing balance using the month-end closing EUR/USD rate.

This distinction is necessary because:

- P&L and transaction flows use monthly average FX;
- consolidated B/S positions use closing FX;
- Calculated Billings requires the deferred-income **movement** as a flow, so using the average rate avoids injecting currency-translation effects into billings.

---

# 7. Group Mapping Treatment

Every coded GL account currently used in the QuickBooks source exists in the supplied Soda group mapping.

Current result:

```text
Distinct coded GL accounts used: 30
Mapped successfully:            30
Unmapped:                         0
```

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

Regular mapping treatment:

`Mapping_Source = GROUP_MAPPING`

Source `Account_Name` remains the QuickBooks account name even if its wording differs from the central mapping description.

The supplied group mapping remains authoritative for reporting classification.

---

# 8. Cost Centre / Class Treatment

QuickBooks `Class` is the source analytical cost-centre field.

Therefore:

`Source_Cost_Centre = QuickBooks Class`

and, where Class is present:

`Mapped_Cost_Centre = cleaned Source_Cost_Centre`

The group mapping's Cost Centre column is treated as a classification/validation expectation, not as a blind replacement.

This preserves the detailed QuickBooks dimensions required by the metrics.

Examples in the current file include:

- Sales
- Marketing
- Operations
- Finance
- Management
- People
- North America

Every current P&L journal line contains a source Class.

Opening-balance and most B/S transaction rows may legitimately have no Class.

---

# 9. Metric Classification Rules for Soda Data Inc.

## 9.1 External revenue

External customer revenue includes:

- `704000 Services`
- future `704001`
- future `704002`

provided the row is not intercompany.

The current Inc file uses `704000`.

---

## 9.2 Recurring revenue

Recurring revenue for CAC includes:

- `704000`
- `704001`

and excludes `704002`.

The current Soda Data Inc. revenue lines on `704000` are classified as external recurring revenue.

---

## 9.3 COGS — subcontractors

Use the common rule:

- Reporting Layer 2 = Subcontractors;
- cost centre = Engineering or Product;
- external counterparty.

Current Inc `613140 Management fees` is:

- Reporting Layer 2 = Subcontractors;
- Class = Management;
- counterparty = Soda Data NV;
- intercompany.

Therefore it is **not** external COGS subcontractor spend.

---

## 9.4 COGS — cloud

Use:

- GL `613200`;
- approved production/cloud supplier;
- external transaction.

Current Soda Data Inc. suppliers under `613200` are:

- Intuit Inc.
- Salesloft Inc.

Neither is on the approved production/cloud supplier list.

Therefore current Inc `613200` rows do **not** qualify as cloud COGS.

---

## 9.5 Sales & Marketing spend

`Is_SM_Spend = TRUE` where:

- row is a P&L expense;
- Class is Sales or Marketing;
- counterparty is external;
- row is metric eligible.

This captures the current Inc Sales/Marketing payroll and operating acquisition spend without allocating general corporate overhead.

---

## 9.6 Deferred income

`Is_Deferred_Income = TRUE` where:

`Account_Code = 493010`

This account supplies the Inc deferred-income movement used in Calculated Billings.

---

# 10. Intercompany Identification

For Soda Data Inc., `SODA_DATA_NV` is the relevant group counterparty.

Set:

`Is_Intercompany = TRUE`

where a row is identified as group activity through either:

- `Counterparty = Soda Data NV`; or
- a structurally intercompany balance account.

Current structural IC accounts include:

- `429010` — Long-term loans from shareholder - USD
- `429011` — Long-term loans from shareholder - EUR
- `489092` — Short-term loans from shareholder

For those rows:

`IC_Counterparty = SODA_DATA_NV`

Rows on cash accounts such as `550050` that explicitly name Soda Data NV as counterparty are also intercompany transaction legs.

`613140` management-fee rows naming Soda Data NV are intercompany and must not feed external operating metrics.

---

# 11. QuickBooks-Specific Validation Rules

## 11.1 General Ledger schema

Expected 10-column sequence:

```text
Account
Account name
Transaction date
Transaction type
Num
Name
Class
Description
Debit
Credit
```

Unexpected structural changes must fail loudly.

Suggested issue code:

`QUICKBOOKS_GL_SCHEMA_MISMATCH`

---

## 11.2 Trial Balance schema

The trial balance financial table uses:

```text
Account Name
Debit
Credit
```

Coded account rows begin with a six-digit GL code followed by the account description.

The `TOTAL` row and footer are not account rows.

Zero-value display rows without a six-digit account code are excluded from account reconciliation.

Suggested issue code:

`QUICKBOOKS_TB_SCHEMA_MISMATCH`

---

## 11.3 Monthly ledger balance

Because the General Ledger contains both sides of the Inc books, total monthly movements should balance:

`SUM(Signed_Local for month) = 0`

Current source result:

```text
April 2026: 0.00 USD
May 2026:   0.00 USD
June 2026:  0.00 USD
```

Suggested failure code:

`QUICKBOOKS_MONTH_IMBALANCE`

---

## 11.4 Trial-balance reconstruction

For each GL account:

`Opening Balance + Debits - Credits = 30-Jun Trial Balance`

The current source contains 30 coded GL accounts.

Current result:

```text
Accounts tested:     30
Accounts reconciled: 30
Differences:           0
```

All 30 account balances reconcile exactly to the cent.

Suggested failure code:

`QUICKBOOKS_TB_RECON_MISMATCH`

This is the principal independent validation of the Inc normalized population.

---

## 11.5 Mapping completeness

Every current coded QuickBooks GL account maps successfully.

If a future account cannot be classified:

```text
Is_Unmapped         = TRUE
Validation_Status   = FAIL
Issue_Codes         includes UNMAPPED_ACCOUNT
Include_In_Metrics  = FALSE
```

---

## 11.6 Date cutoff

Current dated activity runs from:

`2026-04-01` through `2026-06-30`

No current QuickBooks transaction is future-dated relative to the 30 June source cutoff.

Future imports must continue to validate every transaction date against the source reporting cutoff.

---

## 11.7 Source duplicates

Using the normalized stable economic/source fields, the current QuickBooks file contains no exact source duplicates.

Duplicates in future exports must remain visible rather than being silently deleted.

---

# 12. Important QuickBooks Design Decision — Do Not Balance by `Num`

QuickBooks `Num` must be preserved as `Document_Number`, but it is **not** a reliable universal transaction-balancing key in this export.

For example, opposite sides of certain month-end Journal Entries use different sequential `Num` values.

Therefore the adapter must not assume:

`same Num = complete double-entry journal`

QuickBooks controls instead rely on:

1. whole-ledger monthly balancing; and
2. account-by-account reconstruction to the independent trial balance.

This differs from the Exact Online adapter, where Entry Number can be used directly for cross-file journal reconciliation.

---

# 13. Intercompany Controls

## 13.1 Funding transfers

The IC schedule expects Inc funding from Soda Data NV of:

```text
April: 70,000 USD
May:   60,000 USD
June:  80,000 USD
```

The QuickBooks entries on `429010` match these amounts exactly.

The opposite cash-side entries are visible in `550050`.

Current result:

`PASS`

---

## 13.2 Monthly recharge from Soda Data NV

The IC schedule expects:

`28,750 USD per month`

QuickBooks records:

```text
April: 28,750 USD
May:   28,750 USD
June:  25,000 USD
```

The June variance is:

`3,750 USD`

Using the June average EUR/USD rate of `1.15`, this is approximately:

`3,260.87 EUR`

The June records appear consistently on both Inc accounts:

- `613140 Management fees`
- `489092 Short-term loans from shareholder`

so the Inc books themselves balance.

The issue is an **intercompany schedule/counterparty mismatch**, not a local double-entry failure.

Treatment:

```text
Issue_Codes       includes IC_MISMATCH
Validation_Status = WARNING
```

The source amount must not be changed to 28,750 USD and no balancing plug may be created.

Because the underlying rows are genuine booked records, the mismatch is surfaced rather than silently corrected.

The rows remain classified as intercompany, so they do not feed external-revenue or external-cost metrics.

---

## 13.3 Historical EUR shareholder loan

The group structure states that account `429011` represents a fixed:

`EUR 1,100,000`

loan translated into the Inc USD books at month-end closing FX.

The source reconciles exactly:

```text
31-Mar-26: 1,100,000 × 1.1484 = 1,263,240 USD
30-Apr-26: 1,100,000 × 1.1645 = 1,280,950 USD
31-May-26: 1,100,000 × 1.1610 = 1,277,100 USD
30-Jun-26: 1,100,000 × 1.1394 = 1,253,340 USD
```

The monthly QuickBooks FX revaluation entries produce those balances exactly.

Current result:

`PASS`

This should be implemented as a dedicated IC/FX control rather than inferred from ordinary transaction FX translation.

---

# 14. Calculated Billings Sanity Check

The Inc source independently demonstrates the intended billings identity.

Monthly recognized revenue on `704000`:

```text
April: 262,295.19 USD
May:   266,232.94 USD
June:  264,779.35 USD
```

Monthly signed movement on `493010 Deferred Revenue`:

```text
April: +214,312.56 USD
May:   +147,129.79 USD
June:  +115,551.45 USD
```

Because deferred revenue is a credit liability, the economic liability movement is the negative of the accounting-signed movement:

```text
April: -214,312.56 USD
May:   -147,129.79 USD
June:  -115,551.45 USD
```

Therefore:

`Calculated Billings = Revenue + Change in Deferred Income`

produces:

```text
April: 47,982.63 USD
May:  119,103.15 USD
June: 149,227.90 USD
```

These amounts equal the customer subscription invoices recorded in the corresponding months.

This is a strong source-level sanity check for the billings methodology.

For EUR group reporting, translate each monthly flow using that month's average EUR/USD rate.

---

# 15. Acceptance Criteria for the QuickBooks Adapter

The QuickBooks ingestion layer is not complete until all of the following are true:

1. the 10-column General Ledger schema is validated before import;
2. the 3-column Trial Balance financial table is identified correctly;
3. only valid economic journal lines and non-zero coded opening balances are normalized;
4. `Beginning Balance` rows become `OPENING_BALANCE`;
5. opening balances use 31 March closing FX;
6. dated journal movements use monthly average FX for normalized flow `Amount_EUR`;
7. month-end balance-sheet controls reconstruct USD balances first and then use closing FX;
8. QuickBooks `Num` is preserved but is not treated as a universal double-entry key;
9. all 30 current coded GL accounts map successfully;
10. Source `Class` is preserved as the operational cost-centre field;
11. every monthly ledger population balances to zero;
12. reconstructed 30 June account balances reconcile to the independent QuickBooks trial balance;
13. the Inc funding schedule matches April-May-June source entries;
14. the June recharge shortfall of USD 3,750 is surfaced as an IC mismatch and is not corrected or plugged;
15. the EUR 1.1m shareholder loan revaluation reconciles to monthly closing FX;
16. duplicate and future-date controls remain active;
17. a rerun of the same cumulative source data appends zero duplicate normalized rows;
18. downstream Components formulas can use the common normalized schema without QuickBooks-specific calculations.
