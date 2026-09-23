/**
 * Validation, batch controls, idempotent append and shared helpers.
 */

function assertDataHeaders_(ss) {
  const sheet = ss.getSheetByName(CONFIG.DATA_SHEET);

  if (!sheet) {
    throw new Error('Missing required Data tab.');
  }

  const actual = sheet
    .getRange(1, 1, 1, DATA_HEADERS.length)
    .getDisplayValues()[0];

  for (let i = 0; i < DATA_HEADERS.length; i++) {
    if (actual[i] !== DATA_HEADERS[i]) {
      throw new Error(
        'Data schema mismatch at column ' + (i + 1) +
        ': expected "' + DATA_HEADERS[i] +
        '", found "' + actual[i] + '".'
      );
    }
  }
}


function validateRequiredRecordFields_(record) {
  if (!record.Account_Code) {
    addIssue_(record, 'MISSING_REQUIRED_FIELD:Account_Code', 'FAIL');
  }

  if (!(record.Transaction_Date instanceof Date) || isNaN(record.Transaction_Date.getTime())) {
    addIssue_(record, 'INVALID_DATE', 'FAIL');
  }

  if (!isFiniteNumber_(record.Debit_Local)) {
    addIssue_(record, 'MISSING_REQUIRED_FIELD:Debit_Local', 'FAIL');
  }

  if (!isFiniteNumber_(record.Credit_Local)) {
    addIssue_(record, 'MISSING_REQUIRED_FIELD:Credit_Local', 'FAIL');
  }

  if (record.Local_Currency !== 'EUR' && record.Local_Currency !== 'USD') {
    addIssue_(record, 'UNEXPECTED_LOCAL_CURRENCY', 'FAIL');
  }

  if (
    record.Transaction_Currency &&
    record.Transaction_Currency !== 'EUR' &&
    record.Transaction_Currency !== 'USD'
  ) {
    addIssue_(record, 'UNEXPECTED_TRANSACTION_CURRENCY', 'WARNING');
  }
}


/* ------------------------------------------------------------------------- */
/* Exact Online controls                                                      */
/* ------------------------------------------------------------------------- */

function validateExactBaseAmount_(record, sourceBaseAmount) {
  const base = numericOrZero_(sourceBaseAmount);

  if (Math.abs(record.Signed_Local - base) > CONFIG.TOLERANCE) {
    addIssue_(record, 'EXACT_BASE_AMOUNT_MISMATCH', 'FAIL');
  }
}


function validateExactPeriodDate_(record, sourcePeriod) {
  if (!(record.Transaction_Date instanceof Date) || isNaN(record.Transaction_Date.getTime())) {
    return;
  }

  const actualPeriod = Number(sourcePeriod);
  const expectedPeriod = exactFy27Period_(record.Transaction_Date);

  if (actualPeriod !== expectedPeriod) {
    addIssue_(record, 'EXACT_PERIOD_DATE_MISMATCH', 'FAIL');
  }
}


function validateExactCutoff_(record, cutoff) {
  validateDateCutoff_(record, cutoff);
}


function validateExactSecondaryCurrencyColumns_(record, source) {
  const secondaryCurrency = cleanText_(source[EXACT_COL.EXTRA_CURRENCY]);

  if (
    secondaryCurrency &&
    record.Transaction_Currency &&
    secondaryCurrency !== record.Transaction_Currency
  ) {
    addIssue_(record, 'EXACT_CURRENCY_COLUMNS_MISMATCH', 'WARNING');
  }

  const secondaryAmountRaw = source[EXACT_COL.EXTRA_AMOUNT_2];

  if (
    secondaryAmountRaw !== '' &&
    secondaryAmountRaw !== null &&
    typeof secondaryAmountRaw !== 'undefined'
  ) {
    const secondaryAmount = Number(secondaryAmountRaw);

    if (
      Number.isFinite(secondaryAmount) &&
      Math.abs(secondaryAmount - record.Transaction_Amount) > CONFIG.TOLERANCE
    ) {
      addIssue_(record, 'EXACT_TRANSACTION_AMOUNT_COLUMNS_MISMATCH', 'WARNING');
    }
  }
}


function applyExactBatchControls_(records) {
  validateExactOpeningBalance_(records);
  validateExactEntryBalancing_(records);
}


function validateExactOpeningBalance_(records) {
  const opening = records.filter(r => r.Record_Type === 'OPENING_BALANCE');
  const total = opening.reduce(
    (sum, record) => sum + Number(record.Signed_Local || 0),
    0
  );

  if (Math.abs(total) > CONFIG.TOLERANCE) {
    opening.forEach(record => {
      addIssue_(record, 'EXACT_OPENING_BS_IMBALANCE', 'FAIL');
    });
  }
}


function validateExactEntryBalancing_(records) {
  const journalRows = records.filter(
    r => r.Record_Type === 'JOURNAL_LINE' && cleanText_(r.Document_Number)
  );

  const byEntry = {};

  journalRows.forEach(record => {
    const key = cleanText_(record.Document_Number);
    if (!byEntry[key]) byEntry[key] = [];
    byEntry[key].push(record);
  });

  Object.keys(byEntry).forEach(entryNo => {
    const rows = byEntry[entryNo];
    const total = rows.reduce(
      (sum, record) => sum + Number(record.Signed_Local || 0),
      0
    );

    if (Math.abs(total) > CONFIG.TOLERANCE) {
      rows.forEach(record => {
        addIssue_(record, 'EXACT_ENTRY_IMBALANCE', 'FAIL');
      });
    }
  });
}


/* ------------------------------------------------------------------------- */
/* QuickBooks controls                                                        */
/* ------------------------------------------------------------------------- */

function validateQuickBooksCutoff_(record, cutoff) {
  validateDateCutoff_(record, cutoff);
}


function applyQuickBooksBatchControls_(records, tbData, groupRef, cutoff, openingDate) {
  const monthImbalances = validateQuickBooksMonthlyLedger_(records);
  const tbMismatchAccounts = validateQuickBooksTrialBalanceReconciliation_(records, tbData);
  const fundingMismatchPeriods = validateQuickBooksFundingSchedule_(records, groupRef);
  const rechargeMismatchPeriods = validateQuickBooksRechargeSchedule_(records, groupRef);
  const fxLoanMismatchPeriods = validateQuickBooksHistoricalEurLoan_(
    records,
    groupRef,
    cutoff,
    openingDate
  );

  const icMismatchMonths = new Set(
    fundingMismatchPeriods.concat(rechargeMismatchPeriods)
  ).size;

  return {
    monthImbalances: monthImbalances.length,
    tbMismatchAccounts: tbMismatchAccounts.length,
    icMismatchMonths: icMismatchMonths,
    fxLoanMismatchMonths: fxLoanMismatchPeriods.length
  };
}


function validateQuickBooksMonthlyLedger_(records) {
  const byPeriod = {};

  records
    .filter(r => r.Record_Type === 'JOURNAL_LINE')
    .forEach(record => {
      const key = String(record.Period_Key);
      if (!byPeriod[key]) byPeriod[key] = [];
      byPeriod[key].push(record);
    });

  const mismatches = [];

  Object.keys(byPeriod).forEach(key => {
    const rows = byPeriod[key];
    const total = rows.reduce(
      (sum, record) => sum + Number(record.Signed_Local || 0),
      0
    );

    if (Math.abs(total) > CONFIG.TOLERANCE) {
      mismatches.push(key);
      rows.forEach(record => addIssue_(record, 'QUICKBOOKS_MONTH_IMBALANCE', 'FAIL'));
    }
  });

  return mismatches;
}


function validateQuickBooksTrialBalanceReconciliation_(records, tbData) {
  const reconstructed = {};
  const rowsByAccount = {};

  records.forEach(record => {
    const code = record.Account_Code;
    if (!code) return;

    if (!rowsByAccount[code]) rowsByAccount[code] = [];
    rowsByAccount[code].push(record);

    if (
      record.Transaction_Date instanceof Date &&
      record.Transaction_Date.getTime() <= endOfDay_(tbData.asOfDate).getTime()
    ) {
      reconstructed[code] = roundMoney_(
        Number(reconstructed[code] || 0) + Number(record.Signed_Local || 0)
      );
    }
  });

  const allCodes = new Set(
    Object.keys(tbData.balances).concat(Object.keys(reconstructed))
  );

  const mismatches = [];

  allCodes.forEach(code => {
    const tbEntry = tbData.balances[code];
    const calc = roundMoney_(Number(reconstructed[code] || 0));

    if (!tbEntry) {
      mismatches.push(code);
      (rowsByAccount[code] || []).forEach(record =>
        addIssue_(record, 'QUICKBOOKS_TB_RECON_MISMATCH', 'FAIL')
      );
      return;
    }

    const target = roundMoney_(tbEntry.signedBalance);

    if (Math.abs(calc - target) > CONFIG.TOLERANCE) {
      mismatches.push(code);
      (rowsByAccount[code] || []).forEach(record =>
        addIssue_(record, 'QUICKBOOKS_TB_RECON_MISMATCH', 'FAIL')
      );
    }
  });

  return mismatches;
}


function validateQuickBooksFundingSchedule_(records, groupRef) {
  const expected = groupRef.icSchedule.filter(item =>
    item.transaction.toLowerCase() === 'funding transfer' &&
    item.from === 'Soda Data NV' &&
    item.to === 'Soda Data Inc' &&
    item.currency === 'USD'
  );

  const mismatchPeriods = [];

  expected.forEach(item => {
    const period = String(item.periodKey);
    const expectedAmount = Number(item.amount || 0);

    const debtRows = records.filter(r =>
      r.Record_Type === 'JOURNAL_LINE' &&
      String(r.Period_Key) === period &&
      r.Account_Code === '429010' &&
      r.IC_Counterparty === CONFIG.ENTITY.SODA_DATA_NV
    );

    const cashRows = records.filter(r =>
      r.Record_Type === 'JOURNAL_LINE' &&
      String(r.Period_Key) === period &&
      r.Account_Code === '550050' &&
      r.IC_Counterparty === CONFIG.ENTITY.SODA_DATA_NV
    );

    const debtCredit = sumField_(debtRows, 'Credit_Local');
    const cashDebit = sumField_(cashRows, 'Debit_Local');

    if (
      Math.abs(debtCredit - expectedAmount) > CONFIG.TOLERANCE ||
      Math.abs(cashDebit - expectedAmount) > CONFIG.TOLERANCE
    ) {
      mismatchPeriods.push(period);
      debtRows.concat(cashRows).forEach(record =>
        addIssue_(record, 'IC_MISMATCH', 'WARNING')
      );
    }
  });

  return mismatchPeriods;
}


function validateQuickBooksRechargeSchedule_(records, groupRef) {
  const expected = groupRef.icSchedule.filter(item =>
    item.transaction.toLowerCase().indexOf('recharge wages') >= 0 &&
    item.from === 'Soda Data NV' &&
    item.to === 'Soda Data Inc' &&
    item.currency === 'USD'
  );

  const mismatchPeriods = [];

  expected.forEach(item => {
    const period = String(item.periodKey);
    const expectedAmount = Number(item.amount || 0);

    const expenseRows = records.filter(r =>
      r.Record_Type === 'JOURNAL_LINE' &&
      String(r.Period_Key) === period &&
      r.Account_Code === '613140' &&
      r.IC_Counterparty === CONFIG.ENTITY.SODA_DATA_NV
    );

    const currentAccountRows = records.filter(r =>
      r.Record_Type === 'JOURNAL_LINE' &&
      String(r.Period_Key) === period &&
      r.Account_Code === '489092' &&
      r.IC_Counterparty === CONFIG.ENTITY.SODA_DATA_NV
    );

    const expenseDebit = sumField_(expenseRows, 'Debit_Local');
    const currentCredit = sumField_(currentAccountRows, 'Credit_Local');

    if (
      Math.abs(expenseDebit - expectedAmount) > CONFIG.TOLERANCE ||
      Math.abs(currentCredit - expectedAmount) > CONFIG.TOLERANCE
    ) {
      mismatchPeriods.push(period);
      expenseRows.concat(currentAccountRows).forEach(record =>
        addIssue_(record, 'IC_MISMATCH', 'WARNING')
      );
    }
  });

  return mismatchPeriods;
}


function validateQuickBooksHistoricalEurLoan_(records, groupRef, cutoff, openingDate) {
  const accountRows = records.filter(r => r.Account_Code === '429011');
  if (!accountRows.length) return [];

  const periodSet = new Set([String(periodKey_(openingDate))]);

  accountRows
    .filter(r => r.Record_Type === 'JOURNAL_LINE')
    .forEach(r => periodSet.add(String(r.Period_Key)));

  const periods = Array.from(periodSet)
    .map(Number)
    .filter(key => periodKeyToMonthStart_(key).getTime() <= monthStart_(cutoff).getTime())
    .sort((a, b) => a - b);

  const mismatchPeriods = [];

  periods.forEach(period => {
    const monthEnd = endOfMonth_(periodKeyToMonthStart_(period));
    const relevant = accountRows.filter(r =>
      r.Transaction_Date instanceof Date &&
      r.Transaction_Date.getTime() <= monthEnd.getTime()
    );

    const closingSigned = relevant.reduce(
      (sum, r) => sum + Number(r.Signed_Local || 0),
      0
    );

    const fx = groupRef.fxRates[String(period)];
    const closingRate = fx ? fx.closing : null;

    if (!closingRate) {
      relevant.forEach(r => addIssue_(r, 'MISSING_FX_RATE', 'FAIL'));
      mismatchPeriods.push(String(period));
      return;
    }

    const expectedAbs = roundMoney_(groupRef.historicalEurLoanAmount * closingRate);

    if (Math.abs(Math.abs(closingSigned) - expectedAbs) > CONFIG.TOLERANCE) {
      mismatchPeriods.push(String(period));

      const rowsInPeriod = accountRows.filter(r => String(r.Period_Key) === String(period));
      const rowsToFlag = rowsInPeriod.length ? rowsInPeriod : relevant;

      rowsToFlag.forEach(r => addIssue_(r, 'FX_REVALUATION_MISMATCH', 'FAIL'));
    }
  });

  return mismatchPeriods;
}


/* ------------------------------------------------------------------------- */
/* Adsolut / NannyML controls                                                 */
/* ------------------------------------------------------------------------- */

function validateAdsolutBaseAmount_(record, sourceAmount) {
  const amount = numericOrZero_(sourceAmount);

  if (Math.abs(record.Signed_Local - amount) > CONFIG.TOLERANCE) {
    addIssue_(record, 'ADSOLUT_BASE_AMOUNT_MISMATCH', 'FAIL');
  }
}


function validateAdsolutAmountEur_(record, sourceAmountEur) {
  const amountEur = numericOrZero_(sourceAmountEur);

  if (
    Math.abs(record.Amount_EUR - amountEur) > CONFIG.TOLERANCE ||
    (
      record.Transaction_Currency === 'EUR' &&
      Math.abs(record.Signed_Local - amountEur) > CONFIG.TOLERANCE
    )
  ) {
    addIssue_(record, 'ADSOLUT_EUR_AMOUNT_MISMATCH', 'FAIL');
  }
}


function validateAdsolutPeriodDate_(record, sourcePeriod) {
  if (!(record.Transaction_Date instanceof Date) || isNaN(record.Transaction_Date.getTime())) {
    return;
  }

  const actualPeriod = Number(sourcePeriod);
  const expectedPeriod = exactFy27Period_(record.Transaction_Date);

  if (actualPeriod !== expectedPeriod) {
    addIssue_(record, 'ADSOLUT_PERIOD_DATE_MISMATCH', 'FAIL');
  }
}


/**
 * Both copies of a source duplicate remain visible. The first occurrence
 * remains metric-eligible as a warning; subsequent identical occurrences are
 * explicitly excluded from metrics rather than silently deleted.
 */
function applyAdsolutDuplicateTreatment_(records) {
  records.forEach(record => {
    if (
      record.Is_Duplicate === true &&
      Number(record.Duplicate_Occurrence) > 1
    ) {
      addIssue_(record, 'DUPLICATE_EXCLUDED', 'FAIL');
    }
  });
}


function applyAdsolutBatchControls_(records, plRecords, snapshots, groupRef) {
  const plTbMismatches = validateAdsolutPlTbReconciliation_(
    plRecords,
    snapshots
  );

  const icMismatchPeriods = validateAdsolutIcControls_(
    records,
    plRecords,
    groupRef
  );

  const duplicateFingerprints = new Set(
    records
      .filter(record => record.Is_Duplicate === true)
      .map(record => record.Record_Fingerprint)
  );

  const excludedDuplicateRows = records.filter(record =>
    record.Is_Duplicate === true &&
    Number(record.Duplicate_Occurrence) > 1
  ).length;

  return {
    plTbMismatchAccounts: plTbMismatches.length,
    icMismatchMonths: icMismatchPeriods.length,
    duplicateGroups: duplicateFingerprints.size,
    excludedDuplicateRows: excludedDuplicateRows
  };
}


function validateAdsolutPlTbReconciliation_(plRecords, snapshots) {
  const mismatches = [];

  snapshots.slice(1).forEach(snapshot => {
    const throughDate = endOfDay_(snapshot.asOfDate);

    const sourceByAccount = {};

    plRecords.forEach(record => {
      if (
        record.Transaction_Date instanceof Date &&
        record.Transaction_Date.getTime() <= throughDate.getTime()
      ) {
        sourceByAccount[record.Account_Code] = roundMoney_(
          Number(sourceByAccount[record.Account_Code] || 0) +
          Number(record.Signed_Local || 0)
        );
      }
    });

    const allCodes = new Set(
      Object.keys(snapshot.plBalances).concat(
        Object.keys(sourceByAccount)
      )
    );

    allCodes.forEach(accountCode => {
      const tbEntry = snapshot.plBalances[accountCode];
      const sourceTotal = roundMoney_(
        Number(sourceByAccount[accountCode] || 0)
      );

      const tbTotal = tbEntry
        ? roundMoney_(tbEntry.signedBalance)
        : null;

      if (
        tbTotal === null ||
        Math.abs(sourceTotal - tbTotal) > CONFIG.TOLERANCE
      ) {
        const key = String(periodKey_(snapshot.asOfDate)) + '|' + accountCode;
        mismatches.push(key);

        const affectedRows = plRecords.filter(record =>
          record.Account_Code === accountCode &&
          record.Transaction_Date instanceof Date &&
          record.Transaction_Date.getTime() <= throughDate.getTime()
        );

        affectedRows.forEach(record =>
          addIssue_(record, 'ADSOLUT_PL_TB_RECON_MISMATCH', 'FAIL')
        );
      }
    });
  });

  return mismatches;
}


function validateAdsolutIcControls_(records, plRecords, groupRef) {
  const mismatchPeriods = new Set();

  const consultingSchedule = groupRef.icSchedule.filter(item =>
    item.transaction.toLowerCase() === 'data science consulting' &&
    item.from === 'NannyML NV' &&
    item.to === 'Soda Data NV' &&
    item.currency === 'EUR'
  );

  const managementSchedule = groupRef.icSchedule.filter(item =>
    item.transaction.toLowerCase() === 'management fee' &&
    item.from === 'Soda Data NV' &&
    item.to === 'NannyML NV' &&
    item.currency === 'EUR'
  );

  const paymentSchedule = groupRef.icSchedule.filter(item =>
    item.transaction.toLowerCase().indexOf('payment of net current-account balance') >= 0 &&
    item.from === 'Soda Data NV' &&
    item.to === 'NannyML NV' &&
    item.currency === 'EUR'
  );

  const allPeriods = new Set(
    consultingSchedule
      .concat(managementSchedule, paymentSchedule)
      .map(item => String(item.periodKey))
  );

  allPeriods.forEach(period => {
    const consultingExpected = consultingSchedule
      .filter(item => String(item.periodKey) === period)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const managementExpected = managementSchedule
      .filter(item => String(item.periodKey) === period)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const paymentExpected = paymentSchedule
      .filter(item => String(item.periodKey) === period)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const consultingRows = plRecords.filter(record =>
      String(record.Period_Key) === period &&
      record.Account_Code === '749020' &&
      record.IC_Counterparty === CONFIG.ENTITY.SODA_DATA_NV
    );

    const managementRows = plRecords.filter(record =>
      String(record.Period_Key) === period &&
      record.Account_Code === '613140' &&
      record.IC_Counterparty === CONFIG.ENTITY.SODA_DATA_NV
    );

    const currentAccountRows = records.filter(record =>
      record.Record_Type === 'TB_DERIVED_MOVEMENT' &&
      String(record.Period_Key) === period &&
      record.Account_Code === '416091'
    );

    const consultingActual = Math.abs(
      sumField_(consultingRows, 'Credit_Local')
    );

    const managementActual = Math.abs(
      sumField_(managementRows, 'Debit_Local')
    );

    const currentAccountActual = roundMoney_(
      sumField_(currentAccountRows, 'Signed_Local')
    );

    const currentAccountExpected = roundMoney_(
      consultingExpected - managementExpected - paymentExpected
    );

    let mismatch = false;

    if (
      Math.abs(consultingActual - consultingExpected) > CONFIG.TOLERANCE
    ) {
      mismatch = true;
      consultingRows.concat(currentAccountRows).forEach(record =>
        addIssue_(record, 'IC_MISMATCH', 'WARNING')
      );
    }

    if (
      Math.abs(managementActual - managementExpected) > CONFIG.TOLERANCE
    ) {
      mismatch = true;

      const rowsToFlag = managementRows.length
        ? managementRows.concat(currentAccountRows)
        : currentAccountRows;

      rowsToFlag.forEach(record =>
        addIssue_(record, 'IC_MISMATCH', 'WARNING')
      );
    }

    if (
      Math.abs(currentAccountActual - currentAccountExpected) > CONFIG.TOLERANCE
    ) {
      mismatch = true;
      currentAccountRows.forEach(record =>
        addIssue_(record, 'IC_MISMATCH', 'WARNING')
      );
    }

    if (mismatch) {
      mismatchPeriods.add(period);
    }
  });

  return Array.from(mismatchPeriods);
}


/* ------------------------------------------------------------------------- */
/* Common issue handling and append                                           */
/* ------------------------------------------------------------------------- */

function validateDateCutoff_(record, cutoff) {
  if (
    record.Transaction_Date instanceof Date &&
    cutoff instanceof Date &&
    record.Transaction_Date.getTime() > endOfDay_(cutoff).getTime()
  ) {
    record.Is_Future_Dated = true;
    addIssue_(record, 'FUTURE_DATED', 'FAIL');
  }
}


function addIssue_(record, code, severity) {
  if (!record._issues) record._issues = [];

  const exists = record._issues.some(issue => issue.code === code);
  if (!exists) {
    record._issues.push({ code: code, severity: severity });
  }
}


function finalizeValidation_(record) {
  const issues = record._issues || [];
  const hasFail = issues.some(issue => issue.severity === 'FAIL');
  const hasWarning = issues.some(issue => issue.severity === 'WARNING');

  record.Validation_Status = hasFail
    ? 'FAIL'
    : hasWarning
      ? 'WARNING'
      : 'PASS';

  record.Issue_Codes = issues.map(issue => issue.code).join(';');
  record.Include_In_Metrics = !hasFail;

  delete record._issues;
}


function appendNewRecords_(ss, records) {
  const sheet = ss.getSheetByName(CONFIG.DATA_SHEET);
  const lastRow = sheet.getLastRow();
  const existingIds = new Set();

  if (lastRow >= 2) {
    sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getDisplayValues()
      .forEach(row => {
        if (row[0]) existingIds.add(row[0]);
      });
  }

  const newRecords = records.filter(record => !existingIds.has(record.Record_ID));
  const skipped = records.length - newRecords.length;

  if (!newRecords.length) {
    return { appended: 0, skipped: skipped };
  }

  const values = newRecords.map(record =>
    DATA_HEADERS.map(header => {
      const value = record[header];
      return (typeof value === 'undefined' || value === null) ? '' : value;
    })
  );

  const startRow = lastRow + 1;

  sheet
    .getRange(startRow, 1, values.length, DATA_HEADERS.length)
    .setValues(values);

  sheet.getRange(startRow, 5, values.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(startRow, 11, values.length, 1)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, 13, values.length, 1)
    .setNumberFormat('mmm-yy');
  sheet.getRange(startRow, 21, values.length, 3)
    .setNumberFormat('#,##0.00;[Red]-#,##0.00');
  sheet.getRange(startRow, 26, values.length, 1)
    .setNumberFormat('#,##0.00;[Red]-#,##0.00');
  sheet.getRange(startRow, 36, values.length, 1)
    .setNumberFormat('0.0000');
  sheet.getRange(startRow, 38, values.length, 1)
    .setNumberFormat('#,##0.00;[Red]-#,##0.00');

  SpreadsheetApp.flush();

  return {
    appended: newRecords.length,
    skipped: skipped
  };
}


/* ------------------------------------------------------------------------- */
/* Shared utility functions                                                   */
/* ------------------------------------------------------------------------- */

function cleanText_(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}


function normalizeAccountCode_(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '';
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{6})$/);
  if (match) return match[1];

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return String(Math.trunc(numeric)).padStart(6, '0');
  }

  return text;
}


function numericOrZero_(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return 0;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}


function finiteNumberOrNull_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}


function isFiniteNumber_(value) {
  return typeof value === 'number' && Number.isFinite(value);
}


function roundMoney_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}


function moneyKey_(value) {
  const n = Number(value || 0);
  return n.toFixed(2);
}


function coerceDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return cloneDate_(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}


function coerceQuickBooksDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return cloneDate_(value);
  }

  const text = cleanText_(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (match) {
    return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  }

  return coerceDate_(value);
}


function cloneDate_(date) {
  return new Date(date.getTime());
}


function monthStart_(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}


function endOfDay_(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23, 59, 59, 999
  );
}


function endOfMonth_(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}


function periodKey_(date) {
  return date.getFullYear() * 100 + date.getMonth() + 1;
}


function periodKeyToMonthStart_(periodKey) {
  const key = Number(periodKey);
  const year = Math.floor(key / 100);
  const month = key % 100;
  return new Date(year, month - 1, 1);
}


function dateIso_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}


function exactFy27Period_(date) {
  const month = date.getMonth();
  return ((month - 3 + 12) % 12) + 1;
}


function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );

  return bytes
    .map(byte => {
      const value = byte < 0 ? byte + 256 : byte;
      return ('0' + value.toString(16)).slice(-2);
    })
    .join('');
}


function isEmptyRow_(row) {
  return row.every(value => cleanText_(value) === '');
}


function sumField_(records, field) {
  return records.reduce(
    (sum, record) => sum + Number(record[field] || 0),
    0
  );
}


function deriveQuickBooksOpeningDate_(journalDates) {
  if (!journalDates.length) return null;

  const earliest = journalDates.reduce((min, current) =>
    current.getTime() < min.getTime() ? current : min
  );

  const firstDay = monthStart_(earliest);
  return new Date(firstDay.getFullYear(), firstDay.getMonth(), 0);
}


function findQuickBooksCutoff_(values, fileName) {
  // Footer contains a precise QuickBooks export date in the current source.
  for (let r = values.length - 1; r >= Math.max(0, values.length - 12); r--) {
    for (let c = 0; c < Math.min(values[r].length, 2); c++) {
      const parsed = parseUsLongDateFromText_(cleanText_(values[r][c]));
      if (parsed) return parsed;
    }
  }

  // Fallback: infer the final month from names such as "Apr-Jun 2026".
  const inferred = inferMonthRangeCutoffFromFilename_(fileName);
  if (inferred) return inferred;

  return null;
}


function findMetadataDate_(values) {
  const maxRows = Math.min(values.length, 15);

  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < Math.min(values[r].length, 3); c++) {
      const text = cleanText_(values[r][c]);
      const date = parseLongEnglishDateFromText_(text);
      if (date) return date;
    }
  }

  return null;
}


function parseLongEnglishDateFromText_(text) {
  const match = cleanText_(text).match(
    /(?:Date:\s*)?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );

  if (!match) return null;

  return new Date(
    Number(match[3]),
    monthNameToIndex_(match[2]),
    Number(match[1])
  );
}


function parseUsLongDateFromText_(text) {
  const match = cleanText_(text).match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i
  );

  if (!match) return null;

  return new Date(
    Number(match[3]),
    monthNameToIndex_(match[1]),
    Number(match[2])
  );
}


function parseMonthYear_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), 1);
  }

  const match = cleanText_(value).match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i
  );

  if (!match) return null;

  return new Date(Number(match[2]), monthNameToIndex_(match[1]), 1);
}


function monthNameToIndex_(name) {
  const months = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11
  };

  return months[cleanText_(name).toLowerCase()];
}


function inferMonthRangeCutoffFromFilename_(fileName) {
  const monthMap = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  const match = cleanText_(fileName).match(
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-([A-Za-z]{3})\s+(\d{4})/i
  );

  if (!match) return null;

  const month = monthMap[match[1].toLowerCase()];
  if (typeof month === 'undefined') return null;

  return new Date(Number(match[2]), month + 1, 0);
}


function extractDateFromFilename_(fileName) {
  const matches = Array.from(
    cleanText_(fileName).matchAll(/(\d{2})-(\d{2})-(\d{4})/g)
  );

  if (!matches.length) return null;

  const last = matches[matches.length - 1];
  return new Date(Number(last[3]), Number(last[2]) - 1, Number(last[1]));
}


function extractCurrencyAmount_(value, currency) {
  const text = cleanText_(value);
  const escaped = cleanText_(currency).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped + '\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)', 'i');
  const match = text.match(regex);

  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}
