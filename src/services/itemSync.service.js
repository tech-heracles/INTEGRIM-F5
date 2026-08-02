const { db } = require('../config/firestore');
const { getPoolForCompany, sql } = require('../config/sqlServerPool');

const ITEMS_QUERY = `
SELECT
        Code                      = ISNULL(UPPER(LTRIM(RTRIM(A.KOD))), '')
      , Description               = ISNULL(A.PERSHKRIM, '')
      , LongDescription           = ISNULL(A.PERSHKRIM, '')
      , BaseUOM                   = ISNULL(A.NJESSH, '')
      , VAT                       = ISNULL(TVSH.PERQINDJE, 20)
      , CategoryCode              = ISNULL(NULLIF(A.KLASIF,''), 'PA KATEGORI')
      , GroupCode                 = ISNULL(NULLIF(A.KLASIF2,''),'PA GRUPIM')
      , BasePrice                 = A.CMSH
      , ItemType                  = N'Inventar'
      , ExemptFromVAT             = N''
      , Active                    = ISNULL(~A.NOTACTIV,1)
      , ModifiedDate              = A.DATEEDIT
      , BaseBarcode               = A.BC
      , Barcodes = JSON_QUERY((
          SELECT '[' + STRING_AGG(
                     '"' + STRING_ESCAPE(UPPER(LTRIM(RTRIM(scr.BC))), 'json') + '"'
                     , ','
                   ) + ']'
          FROM dbo.ARTIKUJBCSCR scr
          WHERE scr.NRD = A.NRRENDOR
            AND LTRIM(RTRIM(ISNULL(scr.BC, ''))) <> ''
      ))
      , SalesPrices = JSON_QUERY((
          SELECT '[' + STRING_AGG(
                     '{"priceLevel":"' + STRING_ESCAPE(sp.priceLevel, 'json') + '","value":' + CAST(sp.Price AS NVARCHAR(50)) + '}'
                     , ','
                   ) + ']'
          FROM (
              SELECT 'A', A.CMSH  UNION ALL
              SELECT 'B', A.CMSH1 UNION ALL
              SELECT 'C', A.CMSH2 UNION ALL
              SELECT 'D', A.CMSH3 UNION ALL
              SELECT 'E', A.CMSH4 UNION ALL
              SELECT 'F', A.CMSH5 UNION ALL
              SELECT 'G', A.CMSH6 UNION ALL
              SELECT 'H', A.CMSH7 UNION ALL
              SELECT 'I', A.CMSH8 UNION ALL
              SELECT 'J', A.CMSH9
          ) sp(priceLevel, Price)
          WHERE sp.Price IS NOT NULL
            AND sp.Price > 0
            AND EXISTS (SELECT 1 FROM dbo.KLIENT K WHERE K.GRUP = sp.priceLevel)
      ))
FROM    dbo.ARTIKUJ           A
    LEFT JOIN dbo.KLASATATIM   TVSH
        ON A.KODTVSH = TVSH.KOD

        
WHERE A.DATEEDIT >= @lastSync
`;

const FULL_ITEMS_QUERY = ITEMS_QUERY.replace(
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

function sanitizeDocId(rawCode) {
  return String(rawCode)
    .trim()
    .replace(/\//g, '_'); // zevendeso '/' me '_'
}

async function upsertItemsToFirestore(companyId, items) {
  const itemsCollection = db
    .collection('companies')
    .doc(companyId)
    .collection('ITEM');

  const validItems = items.filter((item) => item.Code && item.Code.trim() !== '');
  const skipped = items.length - validItems.length;

  if (skipped > 0) {
    console.warn(`[Sync Warning] ${skipped} rreshta u anashkaluan (Code bosh/i pavlefshem).`);
  }

  const chunks = chunkArray(validItems, FIRESTORE_BATCH_LIMIT);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const item of chunk) {
      const docId = sanitizeDocId(item.Code);
      const docRef = itemsCollection.doc(docId);
      batch.set(
        docRef,
        {
          ...item,
          originalCode: item.Code, // ruajme kodin origjinal te pastruar per referim
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