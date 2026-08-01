const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const ITEM_CATEGORIES_QUERY = `
  SELECT
      code          = ISNULL(NULLIF(A.KLASIF,''), 'PA KATEGORI')
    , description   = ISNULL(MAX(C.PERSHKRIM), '')
    , modifiedDate  = MAX(A.DATEEDIT)
    , groupCode     = ISNULL(NULLIF(A.KLASIF2,''),'PA GRUPIM')
    , printer       = ISNULL(MAX(A.KLASIF3), '')
  FROM ARTIKUJ A
  LEFT JOIN ARTIKUJKLS1 C
    ON A.KLASIF = C.KOD
    
  WHERE A.DATEEDIT >= @lastSync
  GROUP BY
      ISNULL(NULLIF(A.KLASIF,''), 'PA KATEGORI')
    , ISNULL(NULLIF(A.KLASIF2,''),'PA GRUPIM')
`;

const FULL_ITEM_CATEGORIES_QUERY = ITEM_CATEGORIES_QUERY.replace(
  'WHERE A.DATEEDIT >= @lastSync',
  ''
);

// Query-i grupon nga (KLASIF, KLASIF2), keshtu qe nje kategori qe ka artikuj
// ne 2 grupe te ndryshme kthehet si 2 rreshta me te njejtin "code" por
// "groupCode" te ndryshem. Meqe dokumenti ne Firestore identifikohet vetem
// nga "code", pa i bashkuar keta rreshta ketu, rreshti i dyte thjesht do
// mbishkruante te parin (do humbiste grupin e pare). Kjo funksion i bashkon
// rreshtat per te njejtin "code" ne nje dokument te vetem, me "groupCodes"
// si array.
function consolidateItemCategories(rows) {
  const byCode = new Map();

  for (const row of rows) {
    const existing = byCode.get(row.code);

    if (!existing) {
      byCode.set(row.code, {
        code: row.code,
        description: row.description,
        printer: row.printer,
        modifiedDate: row.modifiedDate,
        groupCodes: [row.groupCode],
      });
      continue;
    }

    if (!existing.groupCodes.includes(row.groupCode)) {
      existing.groupCodes.push(row.groupCode);
    }

    // description/printer vijne nga i njejti "code", keshtu qe duhet te jene
    // identike per te gjithe rreshtat me te njejtin "code" - por e mbrojme
    // rastin kur njeri rresht ka vlere e tjetri jo.
    if (!existing.description && row.description) existing.description = row.description;
    if (!existing.printer && row.printer) existing.printer = row.printer;

    if (row.modifiedDate && (!existing.modifiedDate || row.modifiedDate > existing.modifiedDate)) {
      existing.modifiedDate = row.modifiedDate;
    }
  }

  return Array.from(byCode.values());
}

const FIRESTORE_BATCH_LIMIT = 500;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function upsertItemCategoriesToFirestore(companyId, itemCategories) {
  const itemCategoriesCollection = db
    .collection('companies')
    .doc(companyId)
    .collection('ITEM_CATEGORY');

  const chunks = chunkArray(itemCategories, FIRESTORE_BATCH_LIMIT);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const itemCategory of chunk) {
      const docRef = itemCategoriesCollection.doc(String(itemCategory.code));
      batch.set(
        docRef,
        {
          ...itemCategory,
          syncedAt: new Date(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

async function getLastSyncTime(companyId, entity) {
  const metaRef = db
    .collection('companies')
    .doc(companyId)
    .collection('SYNC_META')
    .doc(entity);

  const snap = await metaRef.get();
  if (!snap.exists) return null;
  return snap.data().lastSyncTime?.toDate?.() || null;
}

async function setLastSyncTime(companyId, entity, date) {
  const metaRef = db
    .collection('companies')
    .doc(companyId)
    .collection('SYNC_META')
    .doc(entity);

  await metaRef.set({ lastSyncTime: date }, { merge: true });
}

async function syncItemCategories(companyId, fullSync = false) {
  const pool = await getPoolForCompany(companyId);
  const syncStartedAt = new Date();

  let itemCategories;

  if (fullSync) {
    const result = await pool.request().query(FULL_ITEM_CATEGORIES_QUERY);
    itemCategories = result.recordset;
  } else {
    const lastSync = (await getLastSyncTime(companyId, 'ITEM_CATEGORY')) || new Date(0);
    const result = await pool
      .request()
      .input('lastSync', sql.DateTime, lastSync)
      .query(ITEM_CATEGORIES_QUERY);
    itemCategories = result.recordset;
  }

  if (itemCategories.length === 0) {
    return { companyId, synced: 0, fullSync, message: 'Nuk ka te dhena te reja per sync.' };
  }

  const consolidated = consolidateItemCategories(itemCategories);

  const written = await upsertItemCategoriesToFirestore(companyId, consolidated);
  await setLastSyncTime(companyId, 'ITEM_CATEGORY', syncStartedAt);

  return { companyId, synced: written, fullSync };
}

module.exports = { syncItemCategories };