/**
 * Bound-spreadsheet entry points and user-facing menu.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Soda Finance')
    .addItem('Validate setup', 'validateSetup')
    .addSeparator()
    .addItem('Refresh Exact Online data', 'refreshExactOnline')
    .addItem('Refresh QuickBooks data', 'refreshQuickBooks')
    .addItem('Refresh NannyML / Adsolut data', 'refreshAdsolut')
    .addToUi();
}


/**
 * Checks workbook headers, source-file availability and shared reference files.
 */
function validateSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  assertDataHeaders_(ss);

  const exactFiles = locateExactSourceFiles_();
  const qbFiles = locateQuickBooksSourceFiles_();
  const adsolutFiles = locateAdsolutSourceFiles_();
  const mapping = loadGroupMapping_(exactFiles.mapping);
  const groupRef = loadGroupReference_(qbFiles.structure);

  const message = [
    'Setup valid.',
    '',
    'Exact opening: ' + exactFiles.opening.getName(),
    'Exact B/S: ' + exactFiles.bs.getName(),
    'Exact P&L: ' + exactFiles.pl.getName(),
    '',
    'QuickBooks GL: ' + qbFiles.gl.getName(),
    'QuickBooks TB: ' + qbFiles.tb.getName(),
    '',
    'Adsolut P&L: ' + adsolutFiles.pl.getName(),
    'Adsolut TB snapshots: ' + adsolutFiles.trialBalances.length,
    'Adsolut first TB: ' + adsolutFiles.trialBalances[0].getName(),
    'Adsolut latest TB: ' + adsolutFiles.trialBalances[adsolutFiles.trialBalances.length - 1].getName(),
    '',
    'Mapping accounts loaded: ' + Object.keys(mapping).length,
    'FX months loaded: ' + Object.keys(groupRef.fxRates).length,
    'IC schedule rows loaded: ' + groupRef.icSchedule.length
  ].join('\n');

  SpreadsheetApp.getUi().alert(message);
}


/**
 * End-to-end Exact Online refresh.
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
    const summary = summarizeRecords_(records);

    ss.toast(
      [
        'Exact refresh complete',
        'Source rows normalized: ' + records.length,
        'New rows appended: ' + result.appended,
        'Existing rows skipped: ' + result.skipped,
        'FAIL rows: ' + summary.fail,
        'WARNING rows: ' + summary.warning,
        'Future-dated rows: ' + summary.futureDated,
        'Unmapped rows: ' + summary.unmapped
      ].join(' | '),
      'Soda Finance',
      12
    );

    return Object.assign({
      normalized: records.length,
      appended: result.appended,
      skipped: result.skipped
    }, summary);
  } finally {
    lock.releaseLock();
  }
}


/**
 * End-to-end Soda Data Inc / QuickBooks refresh.
 */
function refreshQuickBooks() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another Soda Finance refresh is already running. Try again shortly.');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    assertDataHeaders_(ss);

    const sourceFiles = locateQuickBooksSourceFiles_();
    const mapping = loadGroupMapping_(sourceFiles.mapping);
    const groupRef = loadGroupReference_(sourceFiles.structure);
    const batch = createBatchContext_();

    const glPack = readExcelAsMatrix_(sourceFiles.gl);
    const tbPack = readExcelAsMatrix_(sourceFiles.tb);

    const glResult = parseQuickBooksGeneralLedger_(
      sourceFiles.gl,
      glPack,
      mapping,
      groupRef,
      batch
    );

    const tbData = parseQuickBooksTrialBalance_(
      sourceFiles.tb,
      tbPack
    );

    const records = glResult.records;

    assignFingerprintsAndDuplicateFlags_(records);

    const controlSummary = applyQuickBooksBatchControls_(
      records,
      tbData,
      groupRef,
      glResult.cutoff,
      glResult.openingDate
    );

    records.forEach(finalizeValidation_);

    const result = appendNewRecords_(ss, records);
    const summary = summarizeRecords_(records);

    ss.toast(
      [
        'QuickBooks refresh complete',
        'Source rows normalized: ' + records.length,
        'New rows appended: ' + result.appended,
        'Existing rows skipped: ' + result.skipped,
        'FAIL rows: ' + summary.fail,
        'WARNING rows: ' + summary.warning,
        'TB mismatches: ' + controlSummary.tbMismatchAccounts,
        'Monthly imbalances: ' + controlSummary.monthImbalances,
        'IC mismatch months: ' + controlSummary.icMismatchMonths,
        'Future-dated rows: ' + summary.futureDated,
        'Unmapped rows: ' + summary.unmapped
      ].join(' | '),
      'Soda Finance',
      14
    );

    return Object.assign({
      normalized: records.length,
      appended: result.appended,
      skipped: result.skipped
    }, summary, controlSummary);
  } finally {
    lock.releaseLock();
  }
}


/**
 * End-to-end NannyML NV / Adsolut refresh.
 */
function refreshAdsolut() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another Soda Finance refresh is already running. Try again shortly.');
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    assertDataHeaders_(ss);

    const sourceFiles = locateAdsolutSourceFiles_();
    const mapping = loadGroupMapping_(sourceFiles.mapping);
    const groupRef = loadGroupReference_(sourceFiles.structure);
    const batch = createBatchContext_();

    const plPack = readExcelAsMatrix_(sourceFiles.pl);
    const plResult = parseAdsolutPL_(
      sourceFiles.pl,
      plPack,
      mapping,
      batch
    );

    const snapshotInputs = sourceFiles.trialBalances.map(file => ({
      file: file,
      pack: readExcelAsMatrix_(file)
    }));

    const snapshots = snapshotInputs.map(item =>
      parseAdsolutTrialBalance_(item.file, item.pack, mapping)
    );

    if (!snapshots.length) {
      throw new Error('ADSOLUT_TB_SCHEMA_MISMATCH: No usable trial-balance snapshots.');
    }

    const latestSnapshot = snapshots[snapshots.length - 1];
    if (
      latestSnapshot.asOfDate.getFullYear() !== plResult.cutoff.getFullYear() ||
      latestSnapshot.asOfDate.getMonth() !== plResult.cutoff.getMonth()
    ) {
      throw new Error(
        'ADSOLUT_SOURCE_PERIOD_MISMATCH: latest TB is ' +
        dateIso_(latestSnapshot.asOfDate) +
        ' but P&L cutoff is ' + dateIso_(plResult.cutoff) + '.'
      );
    }

    const openingRows = buildAdsolutOpeningRows_(
      snapshots[0],
      mapping,
      batch
    );

    const movementRows = deriveAdsolutTBMovements_(
      snapshots,
      mapping,
      batch
    );

    const records = openingRows.concat(movementRows, plResult.records);

    assignFingerprintsAndDuplicateFlags_(records);
    applyAdsolutDuplicateTreatment_(records);

    const controlSummary = applyAdsolutBatchControls_(
      records,
      plResult.records,
      snapshots,
      groupRef
    );

    records.forEach(finalizeValidation_);

    const result = appendNewRecords_(ss, records);
    const summary = summarizeRecords_(records);

    ss.toast(
      [
        'Adsolut refresh complete',
        'Source rows normalized: ' + records.length,
        'New rows appended: ' + result.appended,
        'Existing rows skipped: ' + result.skipped,
        'FAIL rows: ' + summary.fail,
        'WARNING rows: ' + summary.warning,
        'P&L/TB mismatches: ' + controlSummary.plTbMismatchAccounts,
        'IC mismatch months: ' + controlSummary.icMismatchMonths,
        'Duplicate groups: ' + controlSummary.duplicateGroups,
        'Excluded duplicate rows: ' + controlSummary.excludedDuplicateRows,
        'Future-dated rows: ' + summary.futureDated,
        'Unmapped rows: ' + summary.unmapped
      ].join(' | '),
      'Soda Finance',
      16
    );

    return Object.assign({
      normalized: records.length,
      appended: result.appended,
      skipped: result.skipped
    }, summary, controlSummary);
  } finally {
    lock.releaseLock();
  }
}


function createBatchContext_() {
  const now = new Date();

  return {
    batchId: Utilities.formatDate(now, CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss'),
    importedAt: now
  };
}


function summarizeRecords_(records) {
  return {
    fail: records.filter(r => r.Validation_Status === 'FAIL').length,
    warning: records.filter(r => r.Validation_Status === 'WARNING').length,
    futureDated: records.filter(r => r.Is_Future_Dated === true).length,
    unmapped: records.filter(r => r.Is_Unmapped === true).length
  };
}
