/**
 * Bound-spreadsheet entry points and user-facing menu.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Soda Finance')
    .addItem('Refresh monthly data', 'refreshMonthlyData')
    .addItem('Validate setup', 'validateSetup')
    .addSeparator()
    .addItem('Apply workbook protections', 'applyWorkbookProtections')
    .addToUi();
}


/**
 * One-action monthly refresh required by Track B.
 *
 * The three source adapters remain independently testable in Apps Script, but
 * normal monthly operation uses this wrapper only. Components and Dashboard
 * are formula-driven, so they refresh automatically when Data is appended.
 */
function refreshMonthlyData() {
  const startedAt = new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Keep converted workbook matrices only for this one execution. The shared
  // group mapping and group-structure workbooks are used by multiple adapters;
  // caching avoids converting the same XLSX files repeatedly during the same
  // monthly refresh while preserving standalone adapter behaviour.
  beginSourceMatrixCache_();

  let exact;
  let quickBooks;
  let adsolut;
  let cacheStats;

  try {
    exact = refreshExactOnline(true);
    quickBooks = refreshQuickBooks(true);
    adsolut = refreshAdsolut(true);

    applyWorkbookProtections_();
    SpreadsheetApp.flush();
  } finally {
    cacheStats = endSourceMatrixCache_();
  }

  const appended = exact.appended + quickBooks.appended + adsolut.appended;
  const skipped = exact.skipped + quickBooks.skipped + adsolut.skipped;
  const normalized = exact.normalized + quickBooks.normalized + adsolut.normalized;
  const elapsedSeconds = Math.round((new Date().getTime() - startedAt.getTime()) / 1000);

  ss.toast(
    [
      'Monthly refresh complete',
      'Source rows normalized: ' + normalized,
      'New rows appended: ' + appended,
      'Existing rows skipped: ' + skipped,
      'Exact: +' + exact.appended,
      'QuickBooks: +' + quickBooks.appended,
      'Adsolut: +' + adsolut.appended,
      'Workbook conversions: ' + cacheStats.conversions,
      'Cache reuses: ' + cacheStats.hits,
      'Protections refreshed',
      'Dashboard updated automatically',
      'Elapsed: ' + elapsedSeconds + 's'
    ].join(' | '),
    'Soda Finance',
    18
  );

  return {
    normalized: normalized,
    appended: appended,
    skipped: skipped,
    exact: exact,
    quickBooks: quickBooks,
    adsolut: adsolut,
    cache: cacheStats,
    elapsedSeconds: elapsedSeconds
  };
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
function refreshExactOnline(silent) {
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

    if (!silent) {
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
    }

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
function refreshQuickBooks(silent) {
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

    if (!silent) {
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
    }

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
function refreshAdsolut(silent) {
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

    if (!silent) {
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
    }

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
 * User-facing protection refresh.
 */
function applyWorkbookProtections() {
  applyWorkbookProtections_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Workbook protections applied. Only the future Data append area and Dashboard month selector remain editable by collaborators.',
    'Soda Finance',
    10
  );
}


/**
 * Locks model logic while preserving the intended monthly workflow.
 *
 * - Data: populated rows are protected; blank future append rows remain open.
 * - Definitions: fully protected.
 * - Components: fully protected.
 * - Dashboard: protected except the selected-month input D3:F3.
 *
 * The current effective user is the only explicit protection editor. This does
 * not change Drive sharing; it only limits edits inside the spreadsheet.
 */
function applyWorkbookProtections_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const me = Session.getEffectiveUser();
  const myEmail = me.getEmail();
  const prefix = 'SODA_FINANCE_';

  ss.getSheets().forEach(sheet => {
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET)
      .filter(p => (p.getDescription() || '').indexOf(prefix) === 0)
      .forEach(p => {
        if (p.canEdit()) p.remove();
      });
  });

  const data = ss.getSheetByName(CONFIG.DATA_SHEET);
  const definitions = ss.getSheetByName(CONFIG.DEFINITIONS_SHEET);
  const components = ss.getSheetByName('Components');
  const dashboard = ss.getSheetByName('Dashboard');

  if (!data || !definitions || !components || !dashboard) {
    throw new Error('PROTECTION_SETUP_ERROR: expected Data, Definitions, Components and Dashboard tabs.');
  }

  const dataProtection = data.protect()
    .setDescription(prefix + 'DATA_LOCK')
    .setWarningOnly(false);

  const firstBlankRow = Math.max(data.getLastRow() + 1, 2);
  if (firstBlankRow <= data.getMaxRows()) {
    dataProtection.setUnprotectedRanges([
      data.getRange(
        firstBlankRow,
        1,
        data.getMaxRows() - firstBlankRow + 1,
        DATA_HEADERS.length
      )
    ]);
  } else {
    dataProtection.setUnprotectedRanges([]);
  }
  restrictProtectionEditors_(dataProtection, myEmail);

  const definitionsProtection = definitions.protect()
    .setDescription(prefix + 'DEFINITIONS_LOCK')
    .setWarningOnly(false);
  restrictProtectionEditors_(definitionsProtection, myEmail);

  const componentsProtection = components.protect()
    .setDescription(prefix + 'COMPONENTS_LOCK')
    .setWarningOnly(false);
  restrictProtectionEditors_(componentsProtection, myEmail);

  const dashboardProtection = dashboard.protect()
    .setDescription(prefix + 'DASHBOARD_LOCK')
    .setWarningOnly(false)
    .setUnprotectedRanges([dashboard.getRange('D3:F3')]);
  restrictProtectionEditors_(dashboardProtection, myEmail);
}


function restrictProtectionEditors_(protection, myEmail) {
  if (myEmail) protection.addEditor(myEmail);

  const otherEditors = protection.getEditors().filter(user =>
    user.getEmail() && user.getEmail() !== myEmail
  );

  if (otherEditors.length) {
    protection.removeEditors(otherEditors);
  }

  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
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
