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
      `Nuk u gjet konfigurimi ERP per companyId="${companyId}" ne companies/${companyId}/${FINANCA_COLLECTION}/${FINANCA_DOC_ID}`
    );
  }

  const data = snap.data();

  if (!data.server || !data.database || !data.user || !data.password) {
    throw new Error(
      `Config i pamjaftueshem ne ${FINANCA_COLLECTION} per companyId="${companyId}". Duhen: server, database, user, password.`
    );
  }

  // Trajto format "server\instanceName" (p.sh. ".\HERACLES" ose "SERVERNAME\HERACLES")
  let serverHost = data.server;
  let instanceName;

  if (data.server.includes('\\')) {
    const parts = data.server.split('\\');
    serverHost = parts[0] === '' || parts[0] === '.' ? 'localhost' : parts[0];
    instanceName = parts[1];
  }

  const config = {
    server: serverHost,
    database: data.database,
    user: data.user,
    password: data.password,
    options: {
      encrypt: data.encrypt ?? false,
      trustServerCertificate: data.trustServerCertificate ?? true,
      ...(instanceName ? { instanceName } : {}),
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };

  // Port perdoret vetem nese s'ka instanceName (instanca e emeruar e gjen porten vete via SQL Browser)
  if (!instanceName && data.port) {
    config.port = data.port;
  }

  return config;
}

module.exports = { getErpConfig };