const { db } = require('../config/firestore');

const FINANCA_COLLECTION = 'finance';
const FINANCA_DOC_ID = 'f5'; // emer fiks i dokumentit te config-ut

async function getErpConfig(companyId) {
  const docRef = db
    .collection('companies')
    .doc(companyId)
    .collection(FINANCA_COLLECTION)
    .doc(FINANCA_DOC_ID);

  const snap = await docRef.get();

  if (!snap.exists) {
    throw new Error(
      `Nuk u gjet konfigurimi ERP per companyId="${companyId}" ne companies/${companyId}/FINANCA/${FINANCA_DOC_ID}`
    );
  }

  const data = snap.data();

  if (!data.server || !data.database || !data.user || !data.password) {
    throw new Error(
      `Config i pamjaftueshem ne FINANCA per companyId="${companyId}". Duhen: server, database, user, password.`
    );
  }

  return {
    server: data.server,
    port: data.port || 1433,
    database: data.database,
    user: data.user,
    password: data.password,
    options: {
      encrypt: data.encrypt ?? false,
      trustServerCertificate: data.trustServerCertificate ?? true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
}

module.exports = { getErpConfig };