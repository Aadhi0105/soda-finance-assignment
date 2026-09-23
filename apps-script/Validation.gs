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
  if (
    record.Transaction_Date instanceof Date &&
    cutoff instanceof Date &&
    record.Transaction_Date.getTime() > endOfDay_(cutoff).getTime()
  ) {
    record.Is_Future_Dated = true;
    addIssue_(record, 'FUTURE_DATED', 'FAIL');
  }
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


/**
 * Batch controls that cannot be evaluated reliably one row at a time.
 */
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

    if (!byEntry[key]) {
      byEntry[key] = [];
    }

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


function addIssue_(record, code, severity) {
  if (!record._issues) {
    record._issues = [];
  }

  const exists = record._issues.some(issue => issue.code === code);

  if (!exists) {
    record._issues.push({
      code: code,
      severity: severity
    });
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

  // A warning remains metric-eligible. A failure does not.
  record.Include_In_Metrics = !hasFail;

  delete record._issues;
}


/**
 * Appends only Record_IDs that are not already present in Data.
 */
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
    return {
      appended: 0,
      skipped: skipped
    };
  }

  const values = newRecords.map(record =>
    DATA_HEADERS.map(header => {
      const value = record[header];

      if (typeof value === 'undefined' || value === null) {
        return '';
      }

      return value;
    })
  );

  const startRow = lastRow + 1;

  sheet
    .getRange(startRow, 1, values.length, DATA_HEADERS.length)
    .setValues(values);

  // Audit and financial formats.
  sheet.getRange(startRow, 5, values.length, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(startRow, 11, values.length, 1)
    .setNumberFormat('yyyy-mm-dd');
  sheet.getRange(startRow, 13, values.length, 1)
    .setNumberFormat('mmm-yy');

  // Debit, Credit, Signed Local.
  sheet.getRange(startRow, 21, values.length, 3)
    .setNumberFormat('#,##0.00;[Red]-#,##0.00');

  // Transaction amount.
  sheet.getRange(startRow, 26, values.length, 1)
    .setNumberFormat('#,##0.00;[Red]-#,##0.00');

  // FX rate.
  sheet.getRange(startRow, 36, values.length, 1)
    .setNumberFormat('0.0000');

  // EUR amount.
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

  if (!Number.isFinite(number)) {
    return NaN;
  }

  return number;
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
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
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


function periodKey_(date) {
  return (
    date.getFullYear() * 100 +
    date.getMonth() + 1
  );
}


function dateIso_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}


function exactFy27Period_(date) {
  // FY27: April 2026 = P1 ... March 2027 = P12.
  const month = date.getMonth(); // Jan = 0
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


/**
 * Reads "Date: 30 June 2026 by ..." style metadata from the first rows.
 */
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

  return new Date(
    Number(match[3]),
    months[match[2].toLowerCase()],
    Number(match[1])
  );
}


function extractDateFromFilename_(fileName) {
  const matches = Array.from(
    cleanText_(fileName).matchAll(/(\d{2})-(\d{2})-(\d{4})/g)
  );

  if (!matches.length) return null;

  const last = matches[matches.length - 1];

  return new Date(
    Number(last[3]),
    Number(last[2]) - 1,
    Number(last[1])
  );
}
