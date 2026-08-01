const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const LOCATIONS_QUERY = `
  SELECT
      code          = m.KOD
    , description   = ISNULL(m.PERSHKRIM, '')
    , modifiedDate  = m.DATEEDIT
  FROM FINBAZA.dbo.MAGAZINA m
  WHERE m.DATEEDIT >= @lastSync
`;

const FULL_LOCATIONS_QUERY = LOCATIONS_QUERY.replace(
  'WHERE m.DATEEDIT >= @lastSync',
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

async function upsertLocationsToFirestore(companyId, locations) {
  const locationsCollection = db
    .collection('companies')
    .doc(companyId)
    .collection('LOCATION');

  const chunks = chunkArray(locations, FIRESTORE_BATCH_LIMIT);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const location of chunk) {
      const docRef = locationsCollection.doc(String(location.code));
      batch.set(
        docRef,
        {
          ...location,
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

async function syncLocations(companyId, fullSync = false) {
  const pool = await getPoolForCompany(companyId);
  const syncStartedAt = new Date();

  let locations;

  if (fullSync) {
    const result = await pool.request().query(FULL_LOCATIONS_QUERY);
    locations = result.recordset;
  } else {
    const lastSync = (await getLastSyncTime(companyId, 'LOCATION')) || new Date(0);
    const result = await pool
      .request()
      .input('lastSync', sql.DateTime, lastSync)
      .query(LOCATIONS_QUERY);
    locations = result.recordset;
  }

  if (locations.length === 0) {
    return { companyId, synced: 0, fullSync, message: 'Nuk ka te dhena te reja per sync.' };
  }

  const written = await upsertLocationsToFirestore(companyId, locations);
  await setLastSyncTime(companyId, 'LOCATION', syncStartedAt);

  return { companyId, synced: written, fullSync };
}

module.exports = { syncLocations };