# Design Decisions

This file records material architecture, finance, automation and control decisions made during development.

---

## Confirmed Assignment Constraints

### C001 — Track

The project follows Track B: SaaS metrics workbook in Google Sheets.

Required metrics:

- Gross Margin %
- CAC Payback Period
- Calculated Billings

### C002 — Workbook structure

The final Google Sheets workbook will contain four tabs:

1. Data
2. Definitions
3. Components
4. Dashboard

### C003 — Audit trail

Every Dashboard value must trace to Components, and every Components value must trace to Data.

### C004 — History horizon

The workbook must support monthly history from April 2026 through March 2029 without requiring formulas or chart ranges to be manually extended.

---

# Architecture Decisions

## D001 — Raw source files remain outside Git

The original Soda assignment pack and accounting-system exports will remain outside the repository.

Reason:

The pack contains Soda's real structural information even though the transaction values are fictitious. Keeping source files outside Git minimizes accidental disclosure and preserves clear separation between source material and work product.

---

## D002 — Google Sheets is the primary calculation and presentation layer

The final investor metrics, components and dashboard will be calculated and presented in Google Sheets.

Reason:

This preserves a transparent click-through audit trail and matches the required delivery format.

---

## D003 — Apps Script will be used only where automation adds value

Google Apps Script will primarily handle ingestion, normalization, validation and repeatable monthly refresh processes.

Reason:

Structured financial calculations should remain deterministic and inspectable. Automation should reduce manual work without making the financial logic harder to verify.

---

## D004 — AI will not be part of the recurring financial calculation runtime

AI may be used during development for analysis, review, documentation and testing support, but recurring monthly metric calculations will not depend on an LLM.

Reason:

The core transformations and financial calculations are structured and deterministic. Introducing probabilistic model output into that layer would add variability without a clear operational benefit.

---

## D005 — Exceptions are retained and surfaced

Suspicious, incomplete or invalid source records will not be silently deleted or corrected.

They will remain traceable and will be either:

- corrected with evidence,
- excluded with an explicit reason, or
- retained and flagged for review.

Reason:

A visible unresolved issue is preferable to a clean-looking number that contains an undocumented assumption.

---

## D006 — Normalized Data is append-only

The normalized Data layer will be designed as an append-only historical ledger.

Reason:

This supports auditability, repeatability and multi-year history without rebuilding previous months.

---

## D007 — Monthly refresh must be idempotent

Running the same monthly import more than once must not duplicate existing records.

Reason:

A rerunnable process is safer operationally and avoids requiring a user to remember whether an import has already been executed.

---

## D008 — Controls are part of the model, not an afterthought

Validation will be implemented at multiple stages of the workflow rather than only checking the final Dashboard.

Expected control layers:

1. import/schema checks,
2. source reconciliation,
3. mapping/classification checks,
4. intercompany checks,
5. metric-identity checks.

---

## D009 — Normalized accounting signs preserve debit and credit direction

The normalized Data layer uses:

`Signed_Local = Debit_Local - Credit_Local`

Debit values are therefore positive and credit values negative.

Reason:

Preserving accounting signs makes journal and trial-balance reconciliation more transparent. Management-reporting presentation signs can be reversed later in Components without altering the underlying normalized ledger.

---

## D010 — Source row numbers are provenance, not permanent identity

`Source_Row` will be retained for traceability and debugging but will not form the primary basis of record identity.

Reason:

Several accounting exports may be cumulative, and row positions can change when subsequent-month data is added. Using row numbers as permanent identifiers would make the same accounting transaction appear new merely because its position changed.

---

## D011 — Idempotency uses deterministic fingerprints and duplicate occurrences

Each normalized row will receive a deterministic `Record_Fingerprint` derived from stable economic/source fields.

Where identical fingerprints occur, a `Duplicate_Occurrence` number will distinguish each occurrence, and `Record_ID` will be derived from both.

Reason:

The monthly import must be safe to rerun while still preserving genuine duplicate source records for investigation.

---

## D012 — Source duplicates remain visible

The ingestion process will not silently remove identical source rows.

Duplicate records will remain in Data and will be identified through:

- `Is_Duplicate`
- `Validation_Status`
- `Issue_Codes`
- `Include_In_Metrics`

Reason:

An identical source row may represent a real bookkeeping or export problem. Automatically deleting it would improve the output cosmetically while destroying evidence of the underlying issue.

---

## D013 — Source-specific adapters feed one common normalized schema

Exact Online, QuickBooks Online, Adsolut P&L and Adsolut trial-balance inputs will each have source-specific normalization logic.

All adapters must output the same normalized Data schema before mapping, classification and metric logic are applied.

Reason:

Accounting-system formatting differences belong in the ingestion layer. Downstream financial calculations should operate independently of the originating accounting system.

---

## D014 — Trial-balance-derived movements are explicitly identified

Where transaction-level balance-sheet movements are unavailable, monthly movement may be derived from successive trial-balance snapshots.

Such records will use:

`Record_Type = TB_DERIVED_MOVEMENT`

Reason:

Derived movements are valid inputs for specific calculations but are not original journal lines. Explicit labelling preserves the distinction and prevents the audit trail from overstating the granularity of the source data.

---

## D015 — Validation status and metric eligibility are separate controls

Normalized rows will contain both:

- `Validation_Status`
- `Include_In_Metrics`

Validation status will use:

- `PASS`
- `WARNING`
- `FAIL`

Reason:

A warning does not necessarily make a financial record unusable. Separating data-quality status from calculation eligibility allows documented overrides to remain visible without forcing every non-standard record out of the metrics.

---

## D016 — FX methodology is explicit at row level

Normalized rows will record:

- `Local_Currency`
- `FX_Rate`
- `FX_Rate_Type`
- `Amount_EUR`

`FX_Rate_Type` will distinguish:

- `NONE`
- `AVERAGE`
- `CLOSING`

Reason:

FX translation should be inspectable rather than embedded inside opaque formulas. Flow items and month-end balance-sheet positions may require different rates, so the applied methodology must remain visible in the normalized dataset.

---

# Finance Decisions

## F001 — Gross Margin %

Formula:

Gross Margin % = (External Customer Revenue - Direct COGS) / External Customer Revenue

### Revenue scope

Include external customer revenue from:

- 704000 — Services
- 704001 — Premium Support
- 704002 — Forward Deploying Engineers, where present

Exclude:

- intercompany management fees and recharges,
- other operating income,
- financial income,
- FX income.

### COGS scope

Include direct external service-delivery costs only.

Technical subcontractors are included where:

- Reporting Layer 2 = Subcontractors,
- Cost Centre = Engineering or Product,
- counterparty is external.

Cloud infrastructure is included where:

- GL = 613200,
- supplier is classified as production/cloud infrastructure.

Engineering and Product employee payroll is excluded because the current bookkeeping does not distinguish R&D/product-development payroll from directly attributable customer-delivery/support payroll.

### TTM treatment

TTM Gross Margin % is calculated as:

(sum of revenue over 12 months - sum of COGS over 12 months) / sum of revenue over 12 months

Monthly Gross Margin percentages are not averaged.

### Bookkeeping improvement

Introduce a dedicated Customer Delivery / COGS cost centre or accounting dimension to distinguish hosting, customer support and directly attributable service-delivery costs from R&D/Product development.

---

## F002 — CAC Payback Period

Formula:

CAC Payback_t =
Prior-Month Sales & Marketing Spend /
(Current-Month Net-New MRR × Current-Month Gross Margin %)

where:

Net-New MRR_t =
External Recurring Revenue_t - External Recurring Revenue_(t-1)

and:

External Recurring Revenue includes:

- 704000 — Services
- 704001 — Premium Support

704002 — Forward Deploying Engineers is excluded from the recurring-revenue denominator.

### Sales & Marketing spend scope

Include external P&L expenses where:

- Cost Centre = Sales or Marketing,
- the row is an expense,
- the counterparty is external,
- the row passes validation and is metric-eligible.

Exclude corporate overhead cost centres including:

- People
- Finance
- Management
- Operations
- Other

No arbitrary overhead allocation is applied.

### New versus net-new ARR choice

Use net-new recurring revenue as a book-derived proxy because the accounting exports do not identify New, Expansion, Renewal, Contraction or Churn lifecycle events.

### Lag choice

Use a one-month lag:

prior-month Sales & Marketing spend → current-month net-new MRR.

This acknowledges that acquisition expenditure precedes resulting customer revenue while remaining implementable from monthly accounting data.

### Edge-case treatment

If net-new MRR is zero or negative:

CAC Payback = N/M

April 2026 is N/A because the prior-period information required for a comparable calculation is unavailable.

### Bookkeeping improvement

Add a subscription/contract-level revenue dimension containing at least:

- Subscription / Contract ID
- Lifecycle event
- Contract start date
- ARR

This would allow genuine net-new ARR to replace the accounting proxy.

---

## F003 — Calculated Billings

Formula:

Calculated Billings_t =
Recognized External Revenue_t + Change in Deferred Income_t

where:

Change in Deferred Income_t =
Closing Deferred Income_t - Opening Deferred Income_t

### Recognized revenue scope

Include:

- 704000 — Services
- 704001 — Premium Support
- 704002 — Forward Deploying Engineers

Exclude:

- intercompany revenue,
- other operating income,
- financial income,
- FX income.

### Deferred income scope

Use GL:

- 493010 — Deferred income

for all three entities.

Deferred income is represented as a positive economic liability balance for metric calculations.

### NannyML treatment

Where transaction-level balance-sheet movements are unavailable, derive monthly deferred-income movement from successive trial-balance snapshots.

Such rows must be explicitly identified as:

Record_Type = TB_DERIVED_MOVEMENT

They must not be represented as original journal lines.

### FX treatment

For Soda Data Inc., deferred-income movement is translated using the monthly average EUR/USD rate because Calculated Billings is a flow metric.

Month-end deferred-income balance reconciliation may separately use the month-end closing FX rate.

### TTM treatment

TTM Calculated Billings is the sum of the prior 12 complete monthly values.

TTM is displayed only once 12 complete months are available.

### Bookkeeping improvement

Require transaction-level deferred-income movements from each entity in the standardized monthly export, including NannyML.

---

# Classification Rules

## F004 — Metric classification flags

The normalized Data layer will derive explicit flags including:

- Is_External_Revenue
- Is_Recurring_Revenue
- Is_COGS_Subcontractor
- Is_COGS_Cloud
- Is_SM_Spend
- Is_Deferred_Income
- Is_Intercompany
- Include_In_Metrics

Metric calculations will use these explicit flags rather than duplicating complex classification logic throughout the workbook.

---

# Pending Decisions

The following items remain unresolved:

- final normalized Data column schema,
- deterministic Record_ID construction,
- exact supplier-classification table structure,
- exact treatment of each identified source-data issue,
- Apps Script file/module structure,
- exact Google Drive source-folder layout,
- workbook protection configuration,
- final Dashboard layout and chart formatting,
- whether an independent Python validation layer materially improves the submission.