/**
 * Source discovery, Excel conversion, source parsing and shared reference loading.
 */


function listSourceFolderFiles_() {
  const folder = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID);
  const files = [];
  const iterator = folder.getFiles();

  while (iterator.hasNext()) {
    const file = iterator.next();
    if (!file.isTrashed()) files.push(file);
  }

  return files;
}


function locateExactSourceFiles_() {
  const allFiles = listSourceFolderFiles_();

  return {
    opening: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.EXACT_OPENING, 'Exact opening balance'),
    bs: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.EXACT_BS, 'Exact balance-sheet transactions'),
    pl: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.EXACT_PL, 'Exact P&L transactions'),
    mapping: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.GROUP_MAPPING, 'Group mapping')
  };
}


function locateQuickBooksSourceFiles_() {
  const allFiles = listSourceFolderFiles_();

  return {
    gl: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.QUICKBOOKS_GL, 'QuickBooks general ledger'),
    tb: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.QUICKBOOKS_TB, 'QuickBooks trial balance'),
    mapping: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.GROUP_MAPPING, 'Group mapping'),
    structure: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.GROUP_STRUCTURE, 'Group structure / IC / FX')
  };
}


function locateAdsolutSourceFiles_() {
  const allFiles = listSourceFolderFiles_();
  const candidates = findAllMatchingFiles_(
    allFiles,
    CONFIG.FILE_PATTERNS.ADSOLUT_TB,
    'Adsolut trial balance'
  );

  const latestBySnapshot = {};

  candidates.forEach(file => {
    const snapshotDate = extractDateFromFilename_(file.getName());

    if (!snapshotDate) {
      throw new Error(
        'ADSOLUT_TB_DATE_ERROR: trial-balance filenames must contain dd-mm-yyyy dates.'
      );
    }

    const key = dateIso_(snapshotDate);
    const existing = latestBySnapshot[key];

    if (
      !existing ||
      file.getLastUpdated().getTime() > existing.getLastUpdated().getTime()
    ) {
      latestBySnapshot[key] = file;
    }
  });

  const trialBalances = Object.keys(latestBySnapshot)
    .sort()
    .map(key => latestBySnapshot[key]);

  if (trialBalances.length < 2) {
    throw new Error(
      'Missing source files: at least two distinct Adsolut trial-balance snapshots are required.'
    );
  }

  return {
    pl: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.ADSOLUT_PL, 'Adsolut P&L transactions'),
    trialBalances: trialBalances,
    mapping: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.GROUP_MAPPING, 'Group mapping'),
    structure: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.GROUP_STRUCTURE, 'Group structure / IC / FX')
  };
}


function findAllMatchingFiles_(files, pattern, label) {
  const candidates = files.filter(file => pattern.test(file.getName()));

  if (candidates.length === 0) {
    throw new Error(
      'Missing source file: ' + label +
      '. Upload the required file(s) to the configured private source folder.'
    );
  }

  return candidates;
}


function findLatestMatchingFile_(files, pattern, label) {
  const candidates = files.filter(file => pattern.test(file.getName()));

  if (candidates.length === 0) {
    throw new Error(
      'Missing source file: ' + label +
      '. Upload the required file to the configured private source folder.'
    );
  }

  candidates.sort((a, b) => {
    const aDate =
      extractDateFromFilename_(a.getName()) ||
      inferMonthRangeCutoffFromFilename_(a.getName());

    const bDate =
      extractDateFromFilename_(b.getName()) ||
      inferMonthRangeCutoffFromFilename_(b.getName());

    if (aDate && bDate) {
      return bDate.getTime() - aDate.getTime();
    }

    if (aDate) return -1;
    if (bDate) return 1;

    return b.getLastUpdated().getTime() - a.getLastUpdated().getTime();
  });

  return candidates[0];
}


/**
 * Converts XLSX temporarily to a native Google Sheet, reads it, then trashes
 * the temporary conversion.
 */
function readExcelAsMatrix_(file) {
  if (typeof Drive === 'undefined' || !Drive.Files || !Drive.Files.create) {
    throw new Error(
      'Advanced Drive service is not enabled. In Apps Script, add the Drive API service ' +
      'or use the supplied appsscript.json manifest.'
    );
  }

  const tempName = '__SODA_TMP__' + Date.now() + '__' + file.getName();
  const metadata = {
    name: tempName,
    mimeType: 'application/vnd.google-apps.spreadsheet'
  };

  let converted;

  try {
    converted = Drive.Files.create(
      metadata,
      file.getBlob(),
      { fields: 'id,name,mimeType' }
    );

    const tempSpreadsheet = openSpreadsheetWithRetry_(converted.id);
    const sheets = tempSpreadsheet.getSheets();
    const result = {
      spreadsheetId: converted.id,
      sheets: {}
    };

    sheets.forEach(sheet => {
      result.sheets[sheet.getName()] = {
        values: sheet.getDataRange().getValues(),
        displayValues: sheet.getDataRange().getDisplayValues()
      };
    });

    return result;
  } finally {
    if (converted && converted.id) {
      try {
        DriveApp.getFileById(converted.id).setTrashed(true);
      } catch (trashError) {
        console.warn('Could not trash temporary conversion: ' + trashError.message);
      }
    }
  }
}


function openSpreadsheetWithRetry_(spreadsheetId) {
  let lastError = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      lastError = error;
      Utilities.sleep(500 * (attempt + 1));
    }
  }

  throw lastError || new Error('Unable to open temporary converted spreadsheet.');
}


function loadGroupMapping_(mappingFile) {
  const pack = readExcelAsMatrix_(mappingFile);
  const sheet = pack.sheets['Mapping'] || firstSheet_(pack);
  const values = sheet.values;

  const headerIndex = values.findIndex(row =>
    cleanText_(row[0]) === 'Code' &&
    cleanText_(row[1]) === 'Description'
  );

  if (headerIndex < 0) {
    throw new Error('GROUP_MAPPING_SCHEMA_MISMATCH: Could not locate Mapping header row.');
  }

  const headers = values[headerIndex].map(cleanText_);
  const required = [
    'Code',
    'Description',
    'Reporting layer 1',
    'Reporting layer 2',
    'Reporting layer 3',
    'Reporting layer 4',
    'Cost centre',
    'Type',
    'B/S / Profit & Loss',
    'Debit / Credit',
    'Classification'
  ];

  if (headers.length < required.length) {
    throw new Error('GROUP_MAPPING_SCHEMA_MISMATCH: Mapping workbook has too few columns.');
  }

  for (let i = 0; i < required.length; i++) {
    if (headers[i] !== required[i]) {
      throw new Error(
        'GROUP_MAPPING_SCHEMA_MISMATCH at column ' + (i + 1) +
        ': expected "' + required[i] + '", found "' + headers[i] + '".'
      );
    }
  }

  const mapping = {};

  for (let r = headerIndex + 1; r < values.length; r++) {
    const row = values[r];
    const code = normalizeAccountCode_(row[0]);
    if (!code) continue;

    const entry = {
      Code: code,
      Description: cleanText_(row[1]),
      Reporting_L1: cleanText_(row[2]),
      Reporting_L2: cleanText_(row[3]),
      Reporting_L3: cleanText_(row[4]),
      Reporting_L4: cleanText_(row[5]),
      Mapping_Cost_Centre: cleanText_(row[6]),
      Account_Type: cleanText_(row[7]),
      BS_PL: normalizeBsPl_(row[8]),
      Normal_Balance: cleanText_(row[9]),
      Mapping_Classification: cleanText_(row[10])
    };

    if (mapping[code]) {
      throw new Error('Duplicate GL code in group mapping: ' + code);
    }

    mapping[code] = entry;
  }

  return mapping;
}


/**
 * Loads the supplied FX table, IC schedule and fixed EUR shareholder-loan
 * reference from the group-structure workbook.
 */
function loadGroupReference_(structureFile) {
  const pack = readExcelAsMatrix_(structureFile);

  const fxSheet = pack.sheets['FX rates'];
  const icSheet = pack.sheets['IC schedule'];
  const groupSheet = pack.sheets['Group structure'];

  if (!fxSheet || !icSheet || !groupSheet) {
    throw new Error('GROUP_STRUCTURE_SCHEMA_MISMATCH: Expected Group structure, FX rates and IC schedule tabs.');
  }

  const fxRates = {};
  const fxValues = fxSheet.values;

  if (
    cleanText_(fxValues[0][0]) !== 'Month' ||
    cleanText_(fxValues[0][1]) !== 'Average EUR/USD (P&L)' ||
    cleanText_(fxValues[0][2]) !== 'Closing EUR/USD (balance sheet)'
  ) {
    throw new Error('GROUP_FX_SCHEMA_MISMATCH: Unexpected FX-rate headers.');
  }

  for (let r = 1; r < fxValues.length; r++) {
    const monthDate = parseMonthYear_(fxValues[r][0]);
    if (!monthDate) continue;

    const key = String(periodKey_(monthDate));
    fxRates[key] = {
      average: finiteNumberOrNull_(fxValues[r][1]),
      closing: finiteNumberOrNull_(fxValues[r][2]),
      source: cleanText_(fxValues[r][3])
    };
  }

  const icValues = icSheet.values;
  const expectedIcHeaders = [
    'Month',
    'Transaction',
    'From',
    'To',
    'Currency',
    'Amount',
    'Expected in NV',
    'Expected in counterparty'
  ];

  for (let i = 0; i < expectedIcHeaders.length; i++) {
    if (cleanText_(icValues[0][i]) !== expectedIcHeaders[i]) {
      throw new Error('GROUP_IC_SCHEMA_MISMATCH at column ' + (i + 1) + '.');
    }
  }

  const icSchedule = [];

  for (let r = 1; r < icValues.length; r++) {
    const monthDate = parseMonthYear_(icValues[r][0]);
    const transaction = cleanText_(icValues[r][1]);
    if (!monthDate || !transaction) continue;

    icSchedule.push({
      periodKey: periodKey_(monthDate),
      month: monthDate,
      transaction: transaction,
      from: cleanText_(icValues[r][2]),
      to: cleanText_(icValues[r][3]),
      currency: cleanText_(icValues[r][4]),
      amount: finiteNumberOrNull_(icValues[r][5]),
      expectedInNV: cleanText_(icValues[r][6]),
      expectedInCounterparty: cleanText_(icValues[r][7])
    });
  }

  let historicalEurLoanAmount = null;
  const groupValues = groupSheet.values;

  for (let r = 0; r < groupValues.length; r++) {
    const relationship = cleanText_(groupValues[r][0]);
    if (relationship.toLowerCase().indexOf('historical eur loan') >= 0) {
      // The fixed EUR principal is embedded in the relationship/account text,
      // not necessarily in the frequency column. Search the full row.
      historicalEurLoanAmount = extractCurrencyAmount_(
        groupValues[r].map(cleanText_).join(' | '),
        'EUR'
      );
      break;
    }
  }

  if (!historicalEurLoanAmount) {
    throw new Error('GROUP_STRUCTURE_REFERENCE_MISSING: Could not parse historical EUR shareholder loan amount.');
  }

  return {
    fxRates: fxRates,
    icSchedule: icSchedule,
    historicalEurLoanAmount: historicalEurLoanAmount
  };
}


/* ------------------------------------------------------------------------- */
/* Exact Online parsing                                                       */
/* ------------------------------------------------------------------------- */

function parseExactOpening_(file, pack, mapping, batch) {
  const sheet = pack.sheets['Sheet1'] || firstSheet_(pack);
  const values = sheet.values;

  const sourceDate = findMetadataDate_(values);
  if (!sourceDate) {
    throw new Error('Could not determine opening-balance date from ' + file.getName());
  }

  const headerIndex = values.findIndex(row =>
    cleanText_(row[1]) === 'Closing balance (Debit)' &&
    cleanText_(row[2]) === 'Closing balance (Credit)'
  );

  if (headerIndex < 0) {
    throw new Error('EXACT_OPENING_SCHEMA_MISMATCH: Could not locate opening balance headers.');
  }

  const records = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const label = cleanText_(values[r][0]);
    const match = label.match(/^(\d{6})\s*-\s*(.+)$/);
    if (!match) continue;

    const debit = numericOrZero_(values[r][1]);
    const credit = numericOrZero_(values[r][2]);

    const record = buildBaseRecord_(
      batch,
      file.getName(),
      r + 1,
      CONFIG.SOURCE_SYSTEM.EXACT,
      CONFIG.ENTITY.SODA_DATA_NV
    );

    record.Record_Type = 'OPENING_BALANCE';
    record.Transaction_Date = cloneDate_(sourceDate);
    record.Period_Key = periodKey_(sourceDate);
    record.Month = monthStart_(sourceDate);
    record.Account_Code = match[1];
    record.Account_Name = match[2].trim();
    record.Debit_Local = debit;
    record.Credit_Local = credit;
    record.Signed_Local = roundMoney_(debit - credit);
    record.Local_Currency = 'EUR';
    record.Transaction_Currency = 'EUR';
    record.Transaction_Amount = record.Signed_Local;
    record.FX_Rate = 1;
    record.FX_Rate_Type = 'NONE';
    record.Amount_EUR = record.Signed_Local;

    applyMapping_(record, mapping);
    applyMetricClassification_(record);
    validateRequiredRecordFields_(record);

    records.push(record);
  }

  return records;
}


function parseExactTransactions_(file, pack, mapping, batch) {
  const sheet = pack.sheets['Sheet1'] || firstSheet_(pack);
  const values = sheet.values;

  const cutoff = findMetadataDate_(values);
  if (!cutoff) {
    throw new Error('Could not determine source cutoff from ' + file.getName());
  }

  const headerIndex = findExactTransactionHeader_(values);
  const headers = values[headerIndex].map(cleanText_);
  assertExactTransactionHeaders_(headers, file.getName());

  const records = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const source = values[r];
    if (isEmptyRow_(source)) continue;

    const accountCode = normalizeAccountCode_(source[EXACT_COL.GL_CODE]);
    const transactionDate = coerceDate_(source[EXACT_COL.DATE]);
    if (!accountCode && !transactionDate) continue;

    const record = buildBaseRecord_(
      batch,
      file.getName(),
      r + 1,
      CONFIG.SOURCE_SYSTEM.EXACT,
      CONFIG.ENTITY.SODA_DATA_NV
    );

    record.Record_Type = 'JOURNAL_LINE';
    record.Transaction_Date = transactionDate;
    record.Period_Key = transactionDate ? periodKey_(transactionDate) : '';
    record.Month = transactionDate ? monthStart_(transactionDate) : null;
    record.Document_Number = cleanText_(source[EXACT_COL.ENTRY_NO]);
    record.Journal = cleanText_(source[EXACT_COL.JOURNAL]);
    record.Counterparty = cleanText_(source[EXACT_COL.COUNTERPARTY]);
    record.Description = cleanText_(source[EXACT_COL.DESCRIPTION]);
    record.Account_Code = accountCode;
    record.Account_Name = cleanText_(source[EXACT_COL.GL_NAME]);
    record.Source_Cost_Centre = cleanText_(source[EXACT_COL.COST_CENTRE]);
    record.Debit_Local = numericOrZero_(source[EXACT_COL.DEBIT]);
    record.Credit_Local = numericOrZero_(source[EXACT_COL.CREDIT]);
    record.Signed_Local = roundMoney_(record.Debit_Local - record.Credit_Local);
    record.Local_Currency = 'EUR';
    record.Transaction_Currency = cleanText_(source[EXACT_COL.TRANSACTION_CURRENCY]) || 'EUR';
    record.Transaction_Amount = numericOrZero_(source[EXACT_COL.TRANSACTION_AMOUNT]);
    record.FX_Rate = 1;
    record.FX_Rate_Type = 'NONE';
    record.Amount_EUR = record.Signed_Local;

    applyMapping_(record, mapping);
    applyMetricClassification_(record);
    validateRequiredRecordFields_(record);
    validateExactBaseAmount_(record, source[EXACT_COL.BASE_AMOUNT]);
    validateExactPeriodDate_(record, source[EXACT_COL.PERIOD]);
    validateExactCutoff_(record, cutoff);
    validateExactSecondaryCurrencyColumns_(record, source);

    records.push(record);
  }

  return records;
}


function findExactTransactionHeader_(values) {
  for (let r = 0; r < Math.min(values.length, 20); r++) {
    const row = values[r].map(cleanText_);
    if (
      row[0] === 'No.' &&
      row[1] === 'Per.' &&
      row[2] === 'Date' &&
      row[3] === 'Entry no.'
    ) {
      return r;
    }
  }

  throw new Error('EXACT_SCHEMA_MISMATCH: Could not locate Exact transaction header row.');
}


function assertExactTransactionHeaders_(actualHeaders, fileName) {
  if (actualHeaders.length < EXACT_TRANSACTION_HEADERS.length) {
    throw new Error(
      'EXACT_SCHEMA_MISMATCH in ' + fileName +
      ': expected at least ' + EXACT_TRANSACTION_HEADERS.length + ' columns.'
    );
  }

  for (let i = 0; i < EXACT_TRANSACTION_HEADERS.length; i++) {
    const expected = EXACT_TRANSACTION_HEADERS[i];
    const actual = actualHeaders[i];

    if (actual !== expected) {
      throw new Error(
        'EXACT_SCHEMA_MISMATCH in ' + fileName +
        ' at column ' + (i + 1) +
        ': expected "' + expected + '", found "' + actual + '".'
      );
    }
  }
}


/* ------------------------------------------------------------------------- */
/* QuickBooks parsing                                                         */
/* ------------------------------------------------------------------------- */

function parseQuickBooksGeneralLedger_(file, pack, mapping, groupRef, batch) {
  const sheet = pack.sheets['Sheet1'] || firstSheet_(pack);
  const values = sheet.values;

  const headerIndex = findQuickBooksGlHeader_(values);
  assertQuickBooksGlHeaders_(values[headerIndex].map(cleanText_), file.getName());

  const cutoff = findQuickBooksCutoff_(values, file.getName());
  if (!cutoff) {
    throw new Error('Could not determine QuickBooks source cutoff from ' + file.getName());
  }

  const candidateRows = [];
  const journalDates = [];

  for (let r = headerIndex + 1; r < values.length; r++) {
    const source = values[r];
    const accountCode = normalizeAccountCode_(source[QUICKBOOKS_GL_COL.ACCOUNT_CODE]);
    const transactionType = cleanText_(source[QUICKBOOKS_GL_COL.TRANSACTION_TYPE]);

    if (!/^\d{6}$/.test(accountCode)) continue;

    const date = transactionType === 'Beginning Balance'
      ? null
      : coerceQuickBooksDate_(source[QUICKBOOKS_GL_COL.DATE]);

    if (date) journalDates.push(date);

    candidateRows.push({
      sourceRow: r + 1,
      source: source,
      accountCode: accountCode,
      transactionType: transactionType,
      transactionDate: date
    });
  }

  const openingDate = deriveQuickBooksOpeningDate_(journalDates);
  if (!openingDate) {
    throw new Error('QUICKBOOKS_GL_DATE_ERROR: Could not derive opening-balance date.');
  }

  const records = [];

  candidateRows.forEach(item => {
    const source = item.source;
    const debit = numericOrZero_(source[QUICKBOOKS_GL_COL.DEBIT]);
    const credit = numericOrZero_(source[QUICKBOOKS_GL_COL.CREDIT]);

    if (item.transactionType === 'Beginning Balance') {
      if (Math.abs(debit) <= CONFIG.TOLERANCE && Math.abs(credit) <= CONFIG.TOLERANCE) {
        return;
      }
    }

    const record = buildBaseRecord_(
      batch,
      file.getName(),
      item.sourceRow,
      CONFIG.SOURCE_SYSTEM.QUICKBOOKS,
      CONFIG.ENTITY.SODA_DATA_INC
    );

    record.Record_Type = item.transactionType === 'Beginning Balance'
      ? 'OPENING_BALANCE'
      : 'JOURNAL_LINE';

    record.Transaction_Date = item.transactionType === 'Beginning Balance'
      ? cloneDate_(openingDate)
      : item.transactionDate;

    record.Period_Key = record.Transaction_Date ? periodKey_(record.Transaction_Date) : '';
    record.Month = record.Transaction_Date ? monthStart_(record.Transaction_Date) : null;
    record.Document_Number = cleanText_(source[QUICKBOOKS_GL_COL.NUM]);
    record.Journal = item.transactionType;
    record.Counterparty = cleanText_(source[QUICKBOOKS_GL_COL.COUNTERPARTY]);
    record.Description = cleanText_(source[QUICKBOOKS_GL_COL.DESCRIPTION]);
    record.Account_Code = item.accountCode;
    record.Account_Name = cleanText_(source[QUICKBOOKS_GL_COL.ACCOUNT_NAME]);
    record.Source_Cost_Centre = cleanText_(source[QUICKBOOKS_GL_COL.CLASS]);
    record.Debit_Local = debit;
    record.Credit_Local = credit;
    record.Signed_Local = roundMoney_(debit - credit);
    record.Local_Currency = 'USD';
    record.Transaction_Currency = 'USD';
    record.Transaction_Amount = record.Signed_Local;

    applyQuickBooksFx_(record, groupRef.fxRates);
    applyMapping_(record, mapping);
    applyMetricClassification_(record);
    validateRequiredRecordFields_(record);

    if (record.Record_Type === 'JOURNAL_LINE') {
      validateQuickBooksCutoff_(record, cutoff);
    }

    records.push(record);
  });

  return {
    records: records,
    cutoff: cutoff,
    openingDate: openingDate
  };
}


function parseQuickBooksTrialBalance_(file, pack) {
  const sheet = pack.sheets['Sheet1'] || firstSheet_(pack);
  const values = sheet.values;

  const headerIndex = values.findIndex(row =>
    cleanText_(row[0]) === 'Account Name' &&
    cleanText_(row[1]) === 'Debit' &&
    cleanText_(row[2]) === 'Credit'
  );

  if (headerIndex < 0) {
    throw new Error('QUICKBOOKS_TB_SCHEMA_MISMATCH: Could not locate trial-balance header row.');
  }

  const headers = values[headerIndex].map(cleanText_);
  for (let i = 0; i < QUICKBOOKS_TB_HEADERS.length; i++) {
    if (headers[i] !== QUICKBOOKS_TB_HEADERS[i]) {
      throw new Error(
        'QUICKBOOKS_TB_SCHEMA_MISMATCH at column ' + (i + 1) +
        ': expected "' + QUICKBOOKS_TB_HEADERS[i] + '", found "' + headers[i] + '".'
      );
    }
  }

  let asOfDate = null;
  for (let r = 0; r < Math.min(values.length, headerIndex); r++) {
    const parsed = parseUsLongDateFromText_(cleanText_(values[r][0]));
    if (parsed) {
      asOfDate = parsed;
      break;
    }
  }

  if (!asOfDate) {
    asOfDate = extractDateFromFilename_(file.getName());
  }

  if (!asOfDate) {
    throw new Error('QUICKBOOKS_TB_DATE_ERROR: Could not determine trial-balance date.');
  }

  const balances = {};

  for (let r = headerIndex + 1; r < values.length; r++) {
    const label = cleanText_(values[r][0]);
    const match = label.match(/^(\d{6})\s+(.+)$/);
    if (!match) continue;

    const code = match[1];
    const debit = numericOrZero_(values[r][1]);
    const credit = numericOrZero_(values[r][2]);

    if (balances[code]) {
      throw new Error('QUICKBOOKS_TB_SCHEMA_MISMATCH: Duplicate TB account ' + code + '.');
    }

    balances[code] = {
      accountCode: code,
      accountName: match[2].trim(),
      debit: debit,
      credit: credit,
      signedBalance: roundMoney_(debit - credit),
      sourceRow: r + 1
    };
  }

  return {
    asOfDate: asOfDate,
    balances: balances,
    accountCount: Object.keys(balances).length
  };
}


function findQuickBooksGlHeader_(values) {
  for (let r = 0; r < Math.min(values.length, 20); r++) {
    const row = values[r].map(cleanText_);
    if (
      row[0] === 'Account' &&
      row[1] === 'Account name' &&
      row[2] === 'Transaction date' &&
      row[3] === 'Transaction type'
    ) {
      return r;
    }
  }

  throw new Error('QUICKBOOKS_GL_SCHEMA_MISMATCH: Could not locate General Ledger header row.');
}


function assertQuickBooksGlHeaders_(actualHeaders, fileName) {
  if (actualHeaders.length < QUICKBOOKS_GL_HEADERS.length) {
    throw new Error(
      'QUICKBOOKS_GL_SCHEMA_MISMATCH in ' + fileName +
      ': expected at least ' + QUICKBOOKS_GL_HEADERS.length + ' columns.'
    );
  }

  for (let i = 0; i < QUICKBOOKS_GL_HEADERS.length; i++) {
    if (actualHeaders[i] !== QUICKBOOKS_GL_HEADERS[i]) {
      throw new Error(
        'QUICKBOOKS_GL_SCHEMA_MISMATCH in ' + fileName +
        ' at column ' + (i + 1) +
        ': expected "' + QUICKBOOKS_GL_HEADERS[i] + '", found "' + actualHeaders[i] + '".'
      );
    }
  }
}


function applyQuickBooksFx_(record, fxRates) {
  const key = String(record.Period_Key);
  const rates = fxRates[key];
  const rateType = record.Record_Type === 'OPENING_BALANCE' ? 'CLOSING' : 'AVERAGE';
  const rate = rates
    ? (rateType === 'CLOSING' ? rates.closing : rates.average)
    : null;

  record.FX_Rate_Type = rateType;

  if (!rate || !Number.isFinite(rate)) {
    record.FX_Rate = '';
    record.Amount_EUR = '';
    addIssue_(record, 'MISSING_FX_RATE', 'FAIL');
    return;
  }

  record.FX_Rate = rate;
  record.Amount_EUR = roundMoney_(record.Signed_Local / rate);
}


/* ------------------------------------------------------------------------- */
/* Adsolut / NannyML parsing                                                  */
/* ------------------------------------------------------------------------- */

function parseAdsolutPL_(file, pack, mapping, batch) {
  const sheet = pack.sheets['ads-analytisch'];

  if (!sheet) {
    throw new Error(
      'ADSOLUT_PL_SCHEMA_MISMATCH: expected worksheet "ads-analytisch".'
    );
  }

  const values = sheet.values;

  if (!values.length) {
    throw new Error('ADSOLUT_PL_SCHEMA_MISMATCH: P&L workbook is empty.');
  }

  assertAdsolutPlHeaders_(values[0].map(cleanText_), file.getName());

  const cutoff = inferMonthRangeCutoffFromFilename_(file.getName());
  if (!cutoff) {
    throw new Error(
      'ADSOLUT_PL_DATE_ERROR: could not infer period cutoff from ' + file.getName()
    );
  }

  const records = [];

  for (let r = 1; r < values.length; r++) {
    const source = values[r];

    if (isEmptyRow_(source)) continue;

    const accountCode = normalizeAccountCode_(source[ADSOLUT_PL_COL.GL_CODE]);
    if (!/^\d{6}$/.test(accountCode)) continue;

    const transactionDate = coerceDate_(source[ADSOLUT_PL_COL.DATE]);

    const record = buildBaseRecord_(
      batch,
      file.getName(),
      r + 1,
      CONFIG.SOURCE_SYSTEM.ADSOLUT,
      CONFIG.ENTITY.NANNYML_NV
    );

    record.Record_Type = 'JOURNAL_LINE';
    record.Transaction_Date = transactionDate;
    record.Period_Key = transactionDate ? periodKey_(transactionDate) : '';
    record.Month = transactionDate ? monthStart_(transactionDate) : null;
    record.Document_Number = cleanText_(source[ADSOLUT_PL_COL.INVOICE_NUMBER]);
    record.Journal = cleanText_(source[ADSOLUT_PL_COL.JOURNAL]);
    record.Counterparty = cleanText_(source[ADSOLUT_PL_COL.SUPPLIER]);
    record.Description = cleanText_(source[ADSOLUT_PL_COL.DESCRIPTION]);
    record.Account_Code = accountCode;
    record.Account_Name = cleanText_(source[ADSOLUT_PL_COL.GL_NAME]);
    record.Source_Cost_Centre = cleanText_(source[ADSOLUT_PL_COL.COST_CENTRE]);
    record.Debit_Local = numericOrZero_(source[ADSOLUT_PL_COL.DEBIT]);
    record.Credit_Local = numericOrZero_(source[ADSOLUT_PL_COL.CREDIT]);
    record.Signed_Local = roundMoney_(record.Debit_Local - record.Credit_Local);
    record.Local_Currency = 'EUR';
    record.Transaction_Currency =
      cleanText_(source[ADSOLUT_PL_COL.CURRENCY]) || 'EUR';
    record.Transaction_Amount =
      numericOrZero_(source[ADSOLUT_PL_COL.AMOUNT]);
    record.FX_Rate = 1;
    record.FX_Rate_Type = 'NONE';
    record.Amount_EUR =
      numericOrZero_(source[ADSOLUT_PL_COL.AMOUNT_EUR]);

    applyMapping_(record, mapping);
    applyMetricClassification_(record);
    validateRequiredRecordFields_(record);
    validateAdsolutBaseAmount_(record, source[ADSOLUT_PL_COL.AMOUNT]);
    validateAdsolutAmountEur_(record, source[ADSOLUT_PL_COL.AMOUNT_EUR]);
    validateAdsolutPeriodDate_(record, source[ADSOLUT_PL_COL.PERIOD]);
    validateDateCutoff_(record, cutoff);

    records.push(record);
  }

  return {
    records: records,
    cutoff: cutoff
  };
}


function assertAdsolutPlHeaders_(actualHeaders, fileName) {
  if (actualHeaders.length < ADSOLUT_PL_HEADERS.length) {
    throw new Error(
      'ADSOLUT_PL_SCHEMA_MISMATCH in ' + fileName +
      ': expected at least ' + ADSOLUT_PL_HEADERS.length + ' columns.'
    );
  }

  for (let i = 0; i < ADSOLUT_PL_HEADERS.length; i++) {
    if (actualHeaders[i] !== ADSOLUT_PL_HEADERS[i]) {
      throw new Error(
        'ADSOLUT_PL_SCHEMA_MISMATCH in ' + fileName +
        ' at column ' + (i + 1) +
        ': expected "' + ADSOLUT_PL_HEADERS[i] +
        '", found "' + actualHeaders[i] + '".'
      );
    }
  }
}


function parseAdsolutTrialBalance_(file, pack, mapping) {
  const sheet = pack.sheets['ads-balans'];

  if (!sheet) {
    throw new Error(
      'ADSOLUT_TB_SCHEMA_MISMATCH: expected worksheet "ads-balans".'
    );
  }

  const values = sheet.values;

  if (
    cleanText_(values[0] && values[0][0]) !== 'Balance' ||
    cleanText_(values[1] && values[1][0]).toLowerCase().indexOf('nannyml nv') < 0
  ) {
    throw new Error(
      'ADSOLUT_TB_SCHEMA_MISMATCH: unexpected balance header/entity in ' +
      file.getName()
    );
  }

  const asOfDate = extractDateFromFilename_(file.getName());

  if (!asOfDate) {
    throw new Error(
      'ADSOLUT_TB_DATE_ERROR: could not parse snapshot date from ' +
      file.getName()
    );
  }

  const balances = {};
  const bsBalances = {};
  const plBalances = {};

  for (let r = 0; r < values.length; r++) {
    const source = values[r];
    const accountCode = normalizeAccountCode_(
      source[ADSOLUT_TB_COL.ACCOUNT_CODE]
    );

    if (!/^\d{6}$/.test(accountCode)) continue;

    const sourceBalance = finiteNumberOrNull_(
      source[ADSOLUT_TB_COL.BALANCE]
    );

    if (sourceBalance === null) {
      throw new Error(
        'ADSOLUT_TB_SCHEMA_MISMATCH: non-numeric balance for account ' +
        accountCode + ' in ' + file.getName()
      );
    }

    const map = getMappingEntry_(
      accountCode,
      mapping,
      CONFIG.ENTITY.NANNYML_NV
    );

    if (!map) {
      throw new Error(
        'ADSOLUT_TB_UNMAPPED_ACCOUNT: account ' + accountCode +
        ' cannot be signed reliably in ' + file.getName()
      );
    }

    const signedBalance = adsolutSignedBalance_(
      sourceBalance,
      map.Normal_Balance
    );

    const entry = {
      accountCode: accountCode,
      accountName: cleanText_(source[ADSOLUT_TB_COL.ACCOUNT_NAME]),
      sourceBalance: sourceBalance,
      signedBalance: roundMoney_(signedBalance),
      sourceRow: r + 1,
      map: map
    };

    balances[accountCode] = entry;

    if (map.BS_PL === 'BS') {
      bsBalances[accountCode] = entry;
    } else if (map.BS_PL === 'PL') {
      plBalances[accountCode] = entry;
    }
  }

  return {
    fileName: file.getName(),
    asOfDate: asOfDate,
    balances: balances,
    bsBalances: bsBalances,
    plBalances: plBalances
  };
}


function buildAdsolutOpeningRows_(snapshot, mapping, batch) {
  const records = [];

  Object.keys(snapshot.bsBalances)
    .sort()
    .forEach(accountCode => {
      const entry = snapshot.bsBalances[accountCode];
      const signed = roundMoney_(entry.signedBalance);

      const record = buildBaseRecord_(
        batch,
        snapshot.fileName,
        entry.sourceRow,
        CONFIG.SOURCE_SYSTEM.ADSOLUT,
        CONFIG.ENTITY.NANNYML_NV
      );

      record.Record_Type = 'OPENING_BALANCE';
      record.Transaction_Date = cloneDate_(snapshot.asOfDate);
      record.Period_Key = periodKey_(snapshot.asOfDate);
      record.Month = monthStart_(snapshot.asOfDate);
      record.Document_Number = 'TB-OPEN-' + record.Period_Key;
      record.Journal = 'Trial Balance';
      record.Description = 'Opening balance from Adsolut trial balance';
      record.Account_Code = accountCode;
      record.Account_Name = entry.accountName;
      record.Debit_Local = signed >= 0 ? signed : 0;
      record.Credit_Local = signed < 0 ? Math.abs(signed) : 0;
      record.Signed_Local = signed;
      record.Local_Currency = 'EUR';
      record.Transaction_Currency = 'EUR';
      record.Transaction_Amount = signed;
      record.FX_Rate = 1;
      record.FX_Rate_Type = 'NONE';
      record.Amount_EUR = signed;

      applyMapping_(record, mapping);
      applyMetricClassification_(record);
      validateRequiredRecordFields_(record);

      records.push(record);
    });

  return records;
}


function deriveAdsolutTBMovements_(snapshots, mapping, batch) {
  const records = [];

  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];

    const accountCodes = Array.from(new Set(
      Object.keys(previous.bsBalances).concat(
        Object.keys(current.bsBalances)
      )
    )).sort();

    accountCodes.forEach(accountCode => {
      const prevEntry = previous.bsBalances[accountCode];
      const currentEntry = current.bsBalances[accountCode];

      if (!prevEntry || !currentEntry) {
        throw new Error(
          'ADSOLUT_TB_ACCOUNT_MISSING: account ' + accountCode +
          ' is not present in both ' + previous.fileName +
          ' and ' + current.fileName + '.'
        );
      }

      const movement = roundMoney_(
        currentEntry.signedBalance - prevEntry.signedBalance
      );

      const record = buildBaseRecord_(
        batch,
        current.fileName,
        currentEntry.sourceRow,
        CONFIG.SOURCE_SYSTEM.ADSOLUT,
        CONFIG.ENTITY.NANNYML_NV
      );

      record.Record_Type = 'TB_DERIVED_MOVEMENT';
      record.Transaction_Date = cloneDate_(current.asOfDate);
      record.Period_Key = periodKey_(current.asOfDate);
      record.Month = monthStart_(current.asOfDate);
      record.Document_Number = 'TB-MOV-' + record.Period_Key;
      record.Journal = 'TB Derived Movement';
      record.Description =
        'Derived from Adsolut TB ' +
        dateIso_(previous.asOfDate) + ' to ' +
        dateIso_(current.asOfDate);
      record.Account_Code = accountCode;
      record.Account_Name = currentEntry.accountName;
      record.Debit_Local = movement >= 0 ? movement : 0;
      record.Credit_Local = movement < 0 ? Math.abs(movement) : 0;
      record.Signed_Local = movement;
      record.Local_Currency = 'EUR';
      record.Transaction_Currency = 'EUR';
      record.Transaction_Amount = movement;
      record.FX_Rate = 1;
      record.FX_Rate_Type = 'NONE';
      record.Amount_EUR = movement;

      applyMapping_(record, mapping);
      applyMetricClassification_(record);
      validateRequiredRecordFields_(record);

      records.push(record);
    });
  }

  return records;
}


function adsolutSignedBalance_(sourceBalance, normalBalance) {
  const normal = cleanText_(normalBalance).toLowerCase();

  if (normal === 'debit') {
    return Number(sourceBalance);
  }

  if (normal === 'credit') {
    return -Number(sourceBalance);
  }

  throw new Error(
    'ADSOLUT_TB_MAPPING_ERROR: unsupported normal balance "' +
    normalBalance + '".'
  );
}


function firstSheet_(pack) {
  const names = Object.keys(pack.sheets);
  if (!names.length) {
    throw new Error('Converted workbook contains no worksheets.');
  }
  return pack.sheets[names[0]];
}
