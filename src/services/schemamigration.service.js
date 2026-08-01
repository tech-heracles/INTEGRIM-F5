const { getPoolForCompany, sql } = require('../config/sqlServerPool');

// Vetem shkronja, numra dhe underscore lejohen per emra tabelash/kolonash,
// sepse keto vlera futen direkt ne DDL (ALTER TABLE / CREATE TRIGGER) dhe
// nuk mund te parametrizohen si nje query normal.
const IDENTIFIER_REGEX = /^[A-Za-z0-9_]+$/;

function assertValidIdentifier(name, label) {
  if (!name || !IDENTIFIER_REGEX.test(name)) {
    throw new Error(
      `${label} i pavlefshem: "${name}". Lejohen vetem shkronja, numra dhe underscore.`
    );
  }
}

async function columnExists(pool, tableName, columnName) {
  const result = await pool
    .request()
    .input('tableName', sql.NVarChar, tableName)
    .input('columnName', sql.NVarChar, columnName)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo'
        AND TABLE_NAME = @tableName
        AND COLUMN_NAME = @columnName
    `);

  return result.recordset[0].cnt > 0;
}

async function triggerExists(pool, triggerName) {
  const result = await pool
    .request()
    .input('triggerName', sql.NVarChar, triggerName)
    .query(`SELECT COUNT(*) AS cnt FROM sys.triggers WHERE name = @triggerName`);

  return result.recordset[0].cnt > 0;
}

async function detectPrimaryKeyColumns(pool, tableName) {
  const result = await pool
    .request()
    .input('tableName', sql.NVarChar, tableName)
    .query(`
      SELECT ku.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
        ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = ku.TABLE_SCHEMA
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND tc.TABLE_SCHEMA = 'dbo'
        AND tc.TABLE_NAME = @tableName
      ORDER BY ku.ORDINAL_POSITION
    `);

  return result.recordset.map((row) => row.COLUMN_NAME);
}

/**
 * Siguron qe nje tabele te kete kolonen DATEEDIT (DATETIME, default GETDATE())
 * plus nje trigger qe e rifreskon ate ne cdo UPDATE.
 *
 * @param {sql.ConnectionPool} pool
 * @param {{ tableName: string, keyColumns?: string[], dryRun?: boolean }} options
 */
async function ensureDateEditForTable(pool, { tableName, keyColumns, dryRun }) {
  assertValidIdentifier(tableName, 'tableName');

  const plan = {
    tableName,
    columnAdded: false,
    triggerCreated: false,
    skipped: false,
    reason: null,
    generatedSql: [],
  };

  const hasColumn = await columnExists(pool, tableName, 'DATEEDIT');

  if (hasColumn) {
    plan.skipped = true;
    plan.reason = 'DATEEDIT ekziston tashme ne kete tabele.';
    return plan;
  }

  let resolvedKeyColumns = keyColumns;
  if (!resolvedKeyColumns || resolvedKeyColumns.length === 0) {
    resolvedKeyColumns = await detectPrimaryKeyColumns(pool, tableName);
  }

  if (!resolvedKeyColumns || resolvedKeyColumns.length === 0) {
    plan.skipped = true;
    plan.reason =
      'Nuk u gjet primary key per kete tabele dhe nuk u dha "keyColumn"/"keyColumns" manualisht - ' +
      'trigger-i nuk mund te ndertohet pa nje kolone unike per te lidhur "inserted" me tabelen.';
    return plan;
  }

  resolvedKeyColumns.forEach((c) => assertValidIdentifier(c, 'keyColumn'));

  const constraintName = `DF_${tableName}_DATEEDIT`;
  const triggerName = `trg_${tableName}_DATEEDIT`;

  const alterSql = `
ALTER TABLE dbo.[${tableName}]
ADD [DATEEDIT] DATETIME NOT NULL
    CONSTRAINT [${constraintName}] DEFAULT (GETDATE());
`.trim();

  const joinCondition = resolvedKeyColumns
    .map((c) => `t.[${c}] = i.[${c}]`)
    .join(' AND ');

  const triggerSql = `
CREATE TRIGGER [${triggerName}]
ON dbo.[${tableName}]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE t
    SET t.[DATEEDIT] = GETDATE()
    FROM dbo.[${tableName}] t
    INNER JOIN inserted i ON ${joinCondition};
END;
`.trim();

  plan.keyColumns = resolvedKeyColumns;
  plan.generatedSql.push(alterSql, triggerSql);

  if (dryRun) {
    return plan;
  }

  await pool.request().query(alterSql);
  plan.columnAdded = true;

  const alreadyHasTrigger = await triggerExists(pool, triggerName);
  if (alreadyHasTrigger) {
    plan.reason = 'Kolona u shtua; trigger-i ekzistonte tashme (nuk u prek).';
  } else {
    await pool.request().query(triggerSql);
    plan.triggerCreated = true;
  }

  return plan;
}

/**
 * @param {string} companyId
 * @param {Array<string|{tableName: string, keyColumn?: string, keyColumns?: string[]}>} tables
 * @param {boolean} dryRun - kur eshte true, kthen SQL-in qe do ekzekutohej, pa e prekur DB-ne.
 */
async function ensureDateEditColumns(companyId, tables, dryRun = false) {
  const pool = await getPoolForCompany(companyId);
  const results = [];

  for (const tableConfig of tables) {
    const normalized =
      typeof tableConfig === 'string'
        ? { tableName: tableConfig, keyColumns: null }
        : {
            tableName: tableConfig.tableName,
            keyColumns: tableConfig.keyColumn
              ? [tableConfig.keyColumn]
              : tableConfig.keyColumns || null,
          };

    try {
      const result = await ensureDateEditForTable(pool, { ...normalized, dryRun });
      results.push(result);
    } catch (err) {
      results.push({ tableName: normalized.tableName, skipped: true, reason: err.message });
    }
  }

  return results;
}

module.exports = { ensureDateEditColumns, ensureDateEditForTable };

// --- CLI ---
// Lejon qe ky file te ekzekutohet direkt me `node`, pa pasur nevoje per nje
// script te vecante:
//
//   node src/services/schemaMigration.service.js <companyId>            (dry-run)
//   node src/services/schemaMigration.service.js <companyId> --apply     (ekzekuton realisht)
//
// Tabelat qe kontrollohen: DEFAULT_TABLES me poshte, ose kalo JSON permes
// env var TABLES_JSON, p.sh.:
//   TABLES_JSON='["KLIENT", {"tableName":"ARTIKUJ","keyColumn":"KODI"}]' \
//     node src/services/schemaMigration.service.js <companyId>
if (require.main === module) {
  require('dotenv').config();
  const { closeAllPools } = require('../config/sqlServerPool');

  const DEFAULT_TABLES = [{ tableName: 'KLIENT', keyColumn: 'KOD' }];

  (async () => {
    const companyId = process.argv[2];
    const isApply = process.argv.includes('--apply');
    const dryRun = !isApply;

    if (!companyId) {
      console.error(
        'Perdorim: node src/services/schemaMigration.service.js <companyId> [--apply]'
      );
      process.exit(1);
    }

    const tables = process.env.TABLES_JSON
      ? JSON.parse(process.env.TABLES_JSON)
      : DEFAULT_TABLES;

    console.log(`\nDuke u lidhur per companyId="${companyId}" ...`);
    console.log(
      dryRun
        ? '>>> DRY RUN (asnje ndryshim nuk do behet) <<<\n'
        : '>>> APPLY (do ekzekutohet realisht!) <<<\n'
    );

    try {
      const results = await ensureDateEditColumns(companyId, tables, dryRun);
      for (const result of results) {
        console.log(`--- ${result.tableName} ---`);
        console.log(JSON.stringify(result, null, 2));
        console.log('');
      }
    } catch (err) {
      console.error('Gabim:', err.message);
      process.exitCode = 1;
    } finally {
      await closeAllPools();
    }
  })();
}