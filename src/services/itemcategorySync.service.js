const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const ITEM_CATEGORIES_QUERY = `
  SELECT
      code          = ISNULL(NULLIF(A.KLASIF,''), 'PA KATEGORI')
    , description   = MAX(C.PERSHKRIM)
    , modifiedDate  = MAX(A.DATEEDIT)
    , groupCode     = ISNULL(NULLIF(A.KLASIF2,''),'PA GRUPIM')
    , printer       = MAX(C.SHENIM)
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

  const written = await upsertItemCategoriesToFirestore(companyId, itemCategories);
  await setLastSyncTime(companyId, 'ITEM_CATEGORY', syncStartedAt);

  return { companyId, synced: written, fullSync };
}

module.exports = { syncItemCategories };