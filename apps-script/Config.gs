/**
 * Track B — Soda Data SaaS Metrics
 * Configuration and normalized Data contract.
 */

const CONFIG = Object.freeze({
  TIME_ZONE: 'Europe/Brussels',
  DATA_SHEET: 'Data',
  DEFINITIONS_SHEET: 'Definitions',

  // Private Drive folder containing the untouched monthly source exports.
  SOURCE_FOLDER_ID: '18WMrbaWxNdIT6-ZQL14YtjdTu5qoodOR',

  TOLERANCE: 0.01,

  FILE_PATTERNS: Object.freeze({
    EXACT_OPENING: /^Soda_Data_NV - Opening balance sheet - .* \(Exact Online\)\.xlsx$/i,
    EXACT_BS: /^Soda_Data_NV - Transactions FY27 balance sheet accounts - to .* \(Exact Online\)\.xlsx$/i,
    EXACT_PL: /^Soda_Data_NV - Transactions FY27 PL accounts - to .* \(Exact Online\)\.xlsx$/i,
    QUICKBOOKS_GL: /^Soda_Data_Inc - General ledger - .* \(QuickBooks\)\.xlsx$/i,
    QUICKBOOKS_TB: /^Soda_Data_Inc - Trial balance - .* \(QuickBooks\)\.xlsx$/i,
    ADSOLUT_PL: /^NannyML_NV - PL transactions by cost centre - .* \(Adsolut\)\.xlsx$/i,
    ADSOLUT_TB: /^NannyML_NV - Trial balance - .* \(Adsolut\)\.xlsx$/i,
    GROUP_MAPPING: /^Soda_Group - Mapping\.xlsx$/i,
    GROUP_STRUCTURE: /^Soda_Group - Structure IC and FX\.xlsx$/i
  }),

  CLOUD_SUPPLIERS: Object.freeze([
    'Atlas Cloud Services B.V.',
    'Google Cloud EMEA'
  ]),

  EXTERNAL_REVENUE_ACCOUNTS: Object.freeze(['704000', '704001', '704002']),
  RECURRING_REVENUE_ACCOUNTS: Object.freeze(['704000', '704001']),

  ENTITY: Object.freeze({
    SODA_DATA_NV: 'SODA_DATA_NV',
    SODA_DATA_INC: 'SODA_DATA_INC',
    NANNYML_NV: 'NANNYML_NV'
  }),

  SOURCE_SYSTEM: Object.freeze({
    EXACT: 'EXACT',
    QUICKBOOKS: 'QUICKBOOKS',
    ADSOLUT: 'ADSOLUT'
  }),

  LOCAL_CURRENCY: Object.freeze({
    SODA_DATA_NV: 'EUR',
    SODA_DATA_INC: 'USD',
    NANNYML_NV: 'EUR'
  }),

  // Structural intercompany balance accounts by entity.
  IC_STRUCTURAL_COUNTERPARTY: Object.freeze({
    SODA_DATA_NV: Object.freeze({
      '280010': 'SODA_DATA_INC',
      '281001': 'SODA_DATA_INC',
      '281002': 'SODA_DATA_INC',
      '416091': '',
      '280020': 'NANNYML_NV',
      '489093': 'NANNYML_NV',
      '700200': ''
    }),
    SODA_DATA_INC: Object.freeze({
      '429010': 'SODA_DATA_NV',
      '429011': 'SODA_DATA_NV',
      '489092': 'SODA_DATA_NV'
    }),
    NANNYML_NV: Object.freeze({
      '416091': 'SODA_DATA_NV'
    })
  })
});


const DATA_HEADERS = Object.freeze([
  'Record_ID',
  'Record_Fingerprint',
  'Duplicate_Occurrence',
  'Import_Batch_ID',
  'Imported_At',
  'Source_File',
  'Source_System',
  'Source_Row',
  'Entity',
  'Record_Type',
  'Transaction_Date',
  'Period_Key',
  'Month',
  'Document_Number',
  'Journal',
  'Counterparty',
  'Description',
  'Account_Code',
  'Account_Name',
  'Source_Cost_Centre',
  'Debit_Local',
  'Credit_Local',
  'Signed_Local',
  'Local_Currency',
  'Transaction_Currency',
  'Transaction_Amount',
  'Reporting_L1',
  'Reporting_L2',
  'Reporting_L3',
  'Reporting_L4',
  'Mapped_Cost_Centre',
  'BS_PL',
  'Account_Type',
  'Normal_Balance',
  'Mapping_Classification',
  'FX_Rate',
  'FX_Rate_Type',
  'Amount_EUR',
  'Mapping_Source',
  'Is_Intercompany',
  'IC_Counterparty',
  'Is_External_Revenue',
  'Is_Recurring_Revenue',
  'Is_COGS_Subcontractor',
  'Is_COGS_Cloud',
  'Is_SM_Spend',
  'Is_Deferred_Income',
  'Is_Duplicate',
  'Is_Unmapped',
  'Is_Future_Dated',
  'Validation_Status',
  'Issue_Codes',
  'Include_In_Metrics'
]);


const EXACT_TRANSACTION_HEADERS = Object.freeze([
  'No.',
  'Per.',
  'Date',
  'Entry no.',
  'Journal',
  'Description',
  'Account',
  'Debit',
  'Credit',
  'Cost centre',
  'Cost unit',
  'G/L Account',
  'G/L Account',
  'Amount',
  'Cur.',
  'Amount',
  'Your ref.',
  'Matched',
  'Amount',
  'VAT %',
  'VAT',
  'Account: Country',
  'Cur.',
  'Amount',
  'Account: VAT number'
]);


const EXACT_COL = Object.freeze({
  NO: 0,
  PERIOD: 1,
  DATE: 2,
  ENTRY_NO: 3,
  JOURNAL: 4,
  DESCRIPTION: 5,
  COUNTERPARTY: 6,
  DEBIT: 7,
  CREDIT: 8,
  COST_CENTRE: 9,
  COST_UNIT: 10,
  GL_CODE: 11,
  GL_NAME: 12,
  BASE_AMOUNT: 13,
  TRANSACTION_CURRENCY: 14,
  TRANSACTION_AMOUNT: 15,
  YOUR_REF: 16,
  MATCHED: 17,
  EXTRA_AMOUNT_1: 18,
  VAT_PERCENT: 19,
  VAT: 20,
  COUNTRY: 21,
  EXTRA_CURRENCY: 22,
  EXTRA_AMOUNT_2: 23,
  VAT_NUMBER: 24
});


const QUICKBOOKS_GL_HEADERS = Object.freeze([
  'Account',
  'Account name',
  'Transaction date',
  'Transaction type',
  'Num',
  'Name',
  'Class',
  'Description',
  'Debit',
  'Credit'
]);


const QUICKBOOKS_GL_COL = Object.freeze({
  ACCOUNT_CODE: 0,
  ACCOUNT_NAME: 1,
  DATE: 2,
  TRANSACTION_TYPE: 3,
  NUM: 4,
  COUNTERPARTY: 5,
  CLASS: 6,
  DESCRIPTION: 7,
  DEBIT: 8,
  CREDIT: 9
});


const QUICKBOOKS_TB_HEADERS = Object.freeze([
  'Account Name',
  'Debit',
  'Credit'
]);

const ADSOLUT_PL_HEADERS = Object.freeze([
  'Number',
  'Period',
  'Date',
  'Invoice number',
  'Journal',
  'Description',
  'Supplier',
  'Debit',
  'Credit',
  'Cost centre',
  'Cost unit',
  'GL account',
  'GL account name',
  'Amount',
  'Currency',
  'Amount EUR'
]);


const ADSOLUT_PL_COL = Object.freeze({
  NUMBER: 0,
  PERIOD: 1,
  DATE: 2,
  INVOICE_NUMBER: 3,
  JOURNAL: 4,
  DESCRIPTION: 5,
  SUPPLIER: 6,
  DEBIT: 7,
  CREDIT: 8,
  COST_CENTRE: 9,
  COST_UNIT: 10,
  GL_CODE: 11,
  GL_NAME: 12,
  AMOUNT: 13,
  CURRENCY: 14,
  AMOUNT_EUR: 15
});


const ADSOLUT_TB_COL = Object.freeze({
  ACCOUNT_CODE: 2,
  ACCOUNT_NAME: 6,
  BALANCE: 8
});


const DOCUMENTED_MAPPING_OVERRIDES = Object.freeze({
  'NANNYML_NV|749020': Object.freeze({
    Reporting_L1: '',
    Reporting_L2: '',
    Reporting_L3: '',
    Reporting_L4: '',
    Mapping_Cost_Centre: '',
    Account_Type: '',
    BS_PL: 'PL',
    Normal_Balance: 'Credit',
    Mapping_Classification: '',
    Mapping_Source: 'IC_STRUCTURE_OVERRIDE',
    Issue_Code: 'ACCOUNT_NOT_IN_GROUP_MAPPING'
  })
});

