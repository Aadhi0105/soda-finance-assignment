/**
 * Common normalized record construction, mapping and metric classification.
 */

function buildBaseRecord_(batch, sourceFile, sourceRow, sourceSystem, entity) {
  const record = {};

  DATA_HEADERS.forEach(header => {
    record[header] = '';
  });

  record.Import_Batch_ID = batch.batchId;
  record.Imported_At = batch.importedAt;
  record.Source_File = sourceFile;
  record.Source_System = sourceSystem;
  record.Source_Row = sourceRow;
  record.Entity = entity;

  record.Is_Intercompany = false;
  record.Is_External_Revenue = false;
  record.Is_Recurring_Revenue = false;
  record.Is_COGS_Subcontractor = false;
  record.Is_COGS_Cloud = false;
  record.Is_SM_Spend = false;
  record.Is_Deferred_Income = false;

  record.Is_Duplicate = false;
  record.Is_Unmapped = false;
  record.Is_Future_Dated = false;
  record.Include_In_Metrics = true;

  record._issues = [];

  return record;
}


function applyMapping_(record, mapping) {
  const map = getMappingEntry_(record.Account_Code, mapping, record.Entity);

  if (!map) {
    record.Is_Unmapped = true;
    record.Mapping_Source = 'UNMAPPED';
    addIssue_(record, 'UNMAPPED_ACCOUNT', 'FAIL');
    return;
  }

  record.Reporting_L1 = map.Reporting_L1;
  record.Reporting_L2 = map.Reporting_L2;
  record.Reporting_L3 = map.Reporting_L3;
  record.Reporting_L4 = map.Reporting_L4;

  // Preserve transaction-level operational detail where available.
  record.Mapped_Cost_Centre = cleanText_(record.Source_Cost_Centre);

  record.BS_PL = map.BS_PL;
  record.Account_Type = map.Account_Type;
  record.Normal_Balance = map.Normal_Balance;
  record.Mapping_Classification = map.Mapping_Classification;
  record.Mapping_Source = map.Mapping_Source || 'GROUP_MAPPING';

  if (map.Issue_Code) {
    addIssue_(record, map.Issue_Code, 'WARNING');
  }
}


function getMappingEntry_(accountCode, mapping, entity) {
  if (mapping[accountCode]) {
    return Object.assign({
      Mapping_Source: 'GROUP_MAPPING',
      Issue_Code: ''
    }, mapping[accountCode]);
  }

  const key = entity + '|' + accountCode;
  const override = DOCUMENTED_MAPPING_OVERRIDES[key];

  if (override) {
    return Object.assign({
      Code: accountCode,
      Description: ''
    }, override);
  }

  return null;
}


function applyMetricClassification_(record) {
  const code = record.Account_Code;
  const counterparty = normalizeGroupCounterparty_(record.Counterparty);
  const structuralCounterparty = getStructuralIcCounterparty_(record.Entity, code);

  const isIC = Boolean(counterparty || structuralCounterparty !== null);

  record.Is_Intercompany = isIC;
  record.IC_Counterparty = counterparty || structuralCounterparty || '';

  record.Is_External_Revenue =
    CONFIG.EXTERNAL_REVENUE_ACCOUNTS.indexOf(code) >= 0 &&
    !isIC;

  record.Is_Recurring_Revenue =
    CONFIG.RECURRING_REVENUE_ACCOUNTS.indexOf(code) >= 0 &&
    !isIC;

  const cc = cleanText_(record.Mapped_Cost_Centre).toLowerCase();
  const reportingL2 = cleanText_(record.Reporting_L2).toLowerCase();
  const supplier = cleanText_(record.Counterparty).toLowerCase();
  const normalBalance = cleanText_(record.Normal_Balance).toLowerCase();

  record.Is_COGS_Subcontractor =
    reportingL2 === '2. subcontractors' &&
    (cc === 'engineering' || cc === 'product') &&
    !isIC;

  record.Is_COGS_Cloud =
    code === '613200' &&
    CONFIG.CLOUD_SUPPLIERS.some(name => name.toLowerCase() === supplier) &&
    !isIC;

  record.Is_SM_Spend =
    record.BS_PL === 'PL' &&
    normalBalance === 'debit' &&
    (cc === 'sales' || cc === 'marketing') &&
    !isIC;

  record.Is_Deferred_Income = code === '493010';
}


function assignFingerprintsAndDuplicateFlags_(records) {
  const grouped = {};

  records.forEach(record => {
    record.Record_Fingerprint = sha256Hex_(
      [
        record.Entity,
        record.Source_System,
        record.Record_Type,
        dateIso_(record.Transaction_Date),
        cleanText_(record.Document_Number),
        cleanText_(record.Journal),
        record.Account_Code,
        cleanText_(record.Counterparty),
        cleanText_(record.Description),
        moneyKey_(record.Debit_Local),
        moneyKey_(record.Credit_Local),
        cleanText_(record.Source_Cost_Centre),
        cleanText_(record.Transaction_Currency),
        moneyKey_(record.Transaction_Amount)
      ].join('|')
    );

    if (!grouped[record.Record_Fingerprint]) {
      grouped[record.Record_Fingerprint] = [];
    }

    grouped[record.Record_Fingerprint].push(record);
  });

  Object.keys(grouped).forEach(fingerprint => {
    const rows = grouped[fingerprint];

    rows.forEach((record, index) => {
      record.Duplicate_Occurrence = index + 1;
      record.Record_ID = sha256Hex_(
        fingerprint + '|' + record.Duplicate_Occurrence
      );

      if (rows.length > 1) {
        record.Is_Duplicate = true;
        addIssue_(record, 'DUPLICATE_SOURCE_RECORD', 'WARNING');
      }
    });
  });
}


function normalizeGroupCounterparty_(counterparty) {
  const value = cleanText_(counterparty).toLowerCase();

  if (!value) return '';

  if (value.indexOf('soda data inc') >= 0) {
    return CONFIG.ENTITY.SODA_DATA_INC;
  }

  if (value.indexOf('soda data nv') >= 0) {
    return CONFIG.ENTITY.SODA_DATA_NV;
  }

  if (value.indexOf('nannyml') >= 0) {
    return CONFIG.ENTITY.NANNYML_NV;
  }

  return '';
}


function getStructuralIcCounterparty_(entity, accountCode) {
  const byEntity = CONFIG.IC_STRUCTURAL_COUNTERPARTY[entity];

  if (!byEntity) return null;

  if (Object.prototype.hasOwnProperty.call(byEntity, accountCode)) {
    return byEntity[accountCode];
  }

  return null;
}


function normalizeBsPl_(value) {
  const text = cleanText_(value).toLowerCase();

  if (text === 'b/s' || text === 'bs' || text === 'balance sheet') {
    return 'BS';
  }

  if (
    text === 'profit & loss' ||
    text === 'profit and loss' ||
    text === 'p&l' ||
    text === 'pl'
  ) {
    return 'PL';
  }

  return cleanText_(value);
}
