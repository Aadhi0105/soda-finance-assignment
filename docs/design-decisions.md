# Design Decisions

This file records material architecture and control decisions made during development.

Detailed metric definitions are intentionally not recorded yet. They will be added only after the underlying accounting data and definitional choices have been reviewed.

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

## Pending Decisions

The following items remain intentionally unresolved:

- exact Gross Margin definition,
- COGS scope,
- exact CAC Payback formula,
- Sales & Marketing cost scope,
- treatment of overhead,
- definition of new versus net-new revenue/ARR,
- treatment of timing lag,
- exact Calculated Billings implementation,
- treatment of identified source-data issues,
- exact EUR translation methodology by metric component.

These will be resolved before the calculation model is built.