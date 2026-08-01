const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const ITEM_GROUPS_QUERY = `
  SELECT
      code          = ISNULL(NULLIF(A.KLASIF2,''),'PA GRUPIM')
    , description   = MIN(C.PERSHKRIM)
    , modifiedDate   = MAX(C.DATEEDIT)
  FROM ARTIKUJ A
  LEFT JOIN ARTIKUJKLS2 C
    ON A.KLASIF2 = C.KOD

    
  WHERE A.DATEEDIT >= @lastSync
  GROUP BY ISNULL(NULLIF(A.KLASIF2,''),'PA GRUPIM')
`;

const FULL_ITEM_GROUPS_QUERY = ITEM_GROUPS_QUERY.replace(
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

async function upsertItemGroupsToFirestore(companyId, itemGroups) {
  const itemGroupsCollection = db
    .collection('companies')
    .doc(companyId)
    .collection('ITEM_GROUP');

  const chunks = chunkArray(itemGroups, FIRESTORE_BATCH_LIMIT);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const itemGroup of chunk) {
      const docRef = itemGroupsCollection.doc(String(itemGroup.code));
      batch.set(
        docRef,
        {
          ...itemGroup,
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

async function syncItemGroups(companyId, fullSync = false) {
  const pool = await getPoolForCompany(companyId);
  const syncStartedAt = new Date();

  let itemGroups;

  if (fullSync) {
    const result = await pool.request().query(FULL_ITEM_GROUPS_QUERY);
    itemGroups = result.recordset;
  } else {
    const lastSync = (await getLastSyncTime(companyId, 'ITEM_GROUP')) || new Date(0);
    const result = await pool
      .request()
      .input('lastSync', sql.DateTime, lastSync)
      .query(ITEM_GROUPS_QUERY);
    itemGroups = result.recordset;
  }

  if (itemGroups.length === 0) {
    return { companyId, synced: 0, fullSync, message: 'Nuk ka te dhena te reja per sync.' };
  }

  const written = await upsertItemGroupsToFirestore(companyId, itemGroups);
  await setLastSyncTime(companyId, 'ITEM_GROUP', syncStartedAt);

  return { companyId, synced: written, fullSync };
}

module.exports = { syncItemGroups };