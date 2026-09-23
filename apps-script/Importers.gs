/**
 * Source discovery, Excel conversion, source parsing and group mapping.
 */


/**
 * Finds the latest relevant Exact exports plus the group mapping
 * inside the configured private Drive folder.
 */
function locateExactSourceFiles_() {
  const folder = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID);

  const allFiles = [];
  const iterator = folder.getFiles();

  while (iterator.hasNext()) {
    const file = iterator.next();
    if (!file.isTrashed()) {
      allFiles.push(file);
    }
  }

  return {
    opening: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.EXACT_OPENING, 'Exact opening balance'),
    bs: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.EXACT_BS, 'Exact balance-sheet transactions'),
    pl: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.EXACT_PL, 'Exact P&L transactions'),
    mapping: findLatestMatchingFile_(allFiles, CONFIG.FILE_PATTERNS.GROUP_MAPPING, 'Group mapping')
  };
}


/**
 * Picks the latest matching file. Dated file names are compared by their final
 * dd-mm-yyyy token; otherwise last-updated time is used.
 */
function findLatestMatchingFile_(files, pattern, label) {
  const candidates = files.filter(file => pattern.test(file.getName()));

  if (candidates.length === 0) {
    throw new Error(
      'Missing source file: ' + label +
      '. Upload the required file to the configured private source folder.'
    );
  }

  candidates.sort((a, b) => {
    const aDate = extractDateFromFilename_(a.getName());
    const bDate = extractDateFromFilename_(b.getName());

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
 * Converts an XLSX file temporarily to a native Google Sheet, reads values,
 * then trashes the temporary conversion.
 *
 * Requires the Advanced Drive service (Drive API v3) to be enabled.
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


/**
 * Conversion can take a brief moment before SpreadsheetApp can open the file.
 */
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


/**
 * Loads the supplied group mapping workbook into a GL-code keyed object.
 */
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
 * Parses the Soda Data NV opening balance sheet.
 */
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

    const record = buildBaseRecord_(batch, file.getName(), r + 1);
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


/**
 * Parses one Exact transaction export.
 */
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

    // Ignore non-transaction trailing rows if a source export ever contains them.
    const accountCode = normalizeAccountCode_(source[EXACT_COL.GL_CODE]);
    const transactionDate = coerceDate_(source[EXACT_COL.DATE]);

    if (!accountCode && !transactionDate) continue;

    const record = buildBaseRecord_(batch, file.getName(), r + 1);

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


/**
 * Finds the Exact transaction header row without relying on a fixed metadata-row count.
 */
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


/**
 * Exact exports repeat several header names, therefore the entire positional
 * sequence is validated before positional indexing is used.
 */
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


/**
 * Returns the first converted sheet when a fixed name is not applicable.
 */
function firstSheet_(pack) {
  const names = Object.keys(pack.sheets);
  if (!names.length) {
    throw new Error('Converted workbook contains no worksheets.');
  }
  return pack.sheets[names[0]];
}
