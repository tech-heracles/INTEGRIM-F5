const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const CUSTOMERS_QUERY = `
  SELECT
      code          = UPPER(LTRIM(RTRIM(k.KOD)))
    , description   = REPLACE(REPLACE(ISNULL(k.PERSHKRIM, ''), ';', ''), '|', '')
    , nipt          = UPPER(LTRIM(RTRIM(k.NIPT)))
    , priceLevel    = ISNULL(k.GRUP, '')
    , modifiedDate  = k.DATEEDIT
  FROM dbo.KLIENT k
  WHERE k.DATEEDIT >= @lastSync
`;

const FULL_CUSTOMERS_QUERY = CUSTOMERS_QUERY.replace(
  'WHERE k.DATEEDIT >= @lastSync',
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

async function upsertCustomersToFirestore(companyId, customers) {
  const customersCollection = db
    .collection('companies')
    .doc(companyId)
    .collection('CUSTOMER');

  const chunks = chunkArray(customers, FIRESTORE_BATCH_LIMIT);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const customer of chunk) {
      const docRef = customersCollection.doc(String(customer.code));
      batch.set(
        docRef,
        {
          ...customer,
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

async function syncCustomers(companyId, fullSync = false) {
  const pool = await getPoolForCompany(companyId);
  const syncStartedAt = new Date();

  let customers;

  if (fullSync) {
    const result = await pool.request().query(FULL_CUSTOMERS_QUERY);
    customers = result.recordset;
  } else {
    const lastSync = (await getLastSyncTime(companyId, 'CUSTOMER')) || new Date(0);
    const result = await pool
      .request()
      .input('lastSync', sql.DateTime, lastSync)
      .query(CUSTOMERS_QUERY);
    customers = result.recordset;
  }

  if (customers.length === 0) {
    return { companyId, synced: 0, fullSync, message: 'Nuk ka te dhena te reja per sync.' };
  }

  const written = await upsertCustomersToFirestore(companyId, customers);
  await setLastSyncTime(companyId, 'CUSTOMER', syncStartedAt);

  return { companyId, synced: written, fullSync };
}

module.exports = { syncCustomers };