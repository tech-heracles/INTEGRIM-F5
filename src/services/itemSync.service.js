const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const ITEMS_QUERY = `
  SELECT
    ItemCode      AS itemCode,
    ItemName      AS name,
    Barcode       AS barcode,
    SalePrice     AS price,
    Unit          AS unit,
    Category      AS category,
    StockQty      AS stock,
    Active        AS active,
    ModifiedDate  AS modifiedDate
  FROM dbo.Items
  WHERE ModifiedDate >= @lastSync
`;

const FULL_ITEMS_QUERY = ITEMS_QUERY.replace(
  'WHERE ModifiedDate >= @lastSync',
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

async function upsertItemsToFirestore(companyId, items) {
  const itemsCollection = db
    .collection('companies')
    .doc(companyId)
    .collection('ITEM');

  const chunks = chunkArray(items, FIRESTORE_BATCH_LIMIT);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const item of chunk) {
      const docRef = itemsCollection.doc(String(item.itemCode));
      batch.set(
        docRef,
        {
          ...item,
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

async function syncItems(companyId, fullSync = false) {
  const pool = await getPoolForCompany(companyId);
  const syncStartedAt = new Date();

  let items;

  if (fullSync) {
    const result = await pool.request().query(FULL_ITEMS_QUERY);
    items = result.recordset;
  } else {
    const lastSync = (await getLastSyncTime(companyId, 'ITEM')) || new Date(0);
    const result = await pool
      .request()
      .input('lastSync', sql.DateTime, lastSync)
      .query(ITEMS_QUERY);
    items = result.recordset;
  }

  if (items.length === 0) {
    return { companyId, synced: 0, fullSync, message: 'Nuk ka te dhena te reja per sync.' };
  }

  const written = await upsertItemsToFirestore(companyId, items);
  await setLastSyncTime(companyId, 'ITEM', syncStartedAt);

  return { companyId, synced: written, fullSync };
}

module.exports = { syncItems };