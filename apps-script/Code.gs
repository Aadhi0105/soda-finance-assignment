/**
 * Bound-spreadsheet entry points and user-facing menu.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Soda Finance')
    .addItem('Validate setup', 'validateExactSetup')
    .addSeparator()
    .addItem('Refresh Exact Online data', 'refreshExactOnline')
    .addToUi();
}


/**
 * Checks the workbook contract and source folder before an import.
 */
function validateExactSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  assertDataHeaders_(ss);

  const files = locateExactSourceFiles_();
  const mapping = loadGroupMapping_(files.mapping);

  const message = [
    'Setup valid.',
    'Exact opening: ' + files.opening.getName(),
    'Exact B/S: ' + files.bs.getName(),
    'Exact P&L: ' + files.pl.getName(),
    'Mapping accounts loaded: ' + Object.keys(mapping).length
  ].join('\n');

  SpreadsheetApp.getUi().alert(message);
}


/**
 * End-to-end Exact Online refresh:
 * source files -> normalize -> map -> validate -> idempotent append to Data.
 */
function refreshExactOnline() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another Soda Finance refresh is already running. Try again shortly.');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    assertDataHeaders_(ss);

    const sourceFiles = locateExactSourceFiles_();
    const mapping = loadGroupMapping_(sourceFiles.mapping);

    const batch = createBatchContext_();

    const openingPack = readExcelAsMatrix_(sourceFiles.opening);
    const bsPack = readExcelAsMatrix_(sourceFiles.bs);
    const plPack = readExcelAsMatrix_(sourceFiles.pl);

    const openingRows = parseExactOpening_(
      sourceFiles.opening,
      openingPack,
      mapping,
      batch
    );

    const bsRows = parseExactTransactions_(
      sourceFiles.bs,
      bsPack,
      mapping,
      batch
    );

    const plRows = parseExactTransactions_(
      sourceFiles.pl,
      plPack,
      mapping,
      batch
    );

    const records = openingRows.concat(bsRows, plRows);

    assignFingerprintsAndDuplicateFlags_(records);
    applyExactBatchControls_(records);
    records.forEach(finalizeValidation_);

    const result = appendNewRecords_(ss, records);

    const failCount = records.filter(r => r.Validation_Status === 'FAIL').length;
    const warningCount = records.filter(r => r.Validation_Status === 'WARNING').length;
    const futureCount = records.filter(r => r.Is_Future_Dated === true).length;
    const unmappedCount = records.filter(r => r.Is_Unmapped === true).length;

    ss.toast(
      [
        'Exact refresh complete',
        'Source rows normalized: ' + records.length,
        'New rows appended: ' + result.appended,
        'Existing rows skipped: ' + result.skipped,
        'FAIL rows: ' + failCount,
        'WARNING rows: ' + warningCount,
        'Future-dated rows: ' + futureCount,
        'Unmapped rows: ' + unmappedCount
      ].join(' | '),
      'Soda Finance',
      12
    );

    return {
      normalized: records.length,
      appended: result.appended,
      skipped: result.skipped,
      fail: failCount,
      warning: warningCount,
      futureDated: futureCount,
      unmapped: unmappedCount
    };
  } finally {
    lock.releaseLock();
  }
}


/**
 * Creates audit metadata for one refresh execution.
 */
function createBatchContext_() {
  const now = new Date();

  return {
    batchId: Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss'),
    importedAt: now
  };
}
