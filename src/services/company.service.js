const { db } = require('../config/firestore');

async function getErpConfig(companyId) {
  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();

  if (!companySnap.exists) {
    throw new Error(`Nuk u gjet kompania per companyId="${companyId}".`);
  }

  const activeErpType = companySnap.data().activeErpType;

  if (!activeErpType) {
    throw new Error(
      `Kompania companyId="${companyId}" nuk ka nje integrim ERP aktiv (fusha "activeErpType" mungon).`
    );
  }

  if (activeErpType !== 'financa5') {
    throw new Error(
      `Integrimi "${activeErpType}" nuk eshte akoma i mbeshtetur nga POS Sync Service (vetem "financa5" per momentin).`
    );
  }

  const integrationSnap = await companyRef
    .collection('erpIntegrations')
    .doc(activeErpType)
    .get();

  if (!integrationSnap.exists) {
    throw new Error(
      `Nuk u gjet konfigurimi ne companies/${companyId}/erpIntegrations/${activeErpType}.`
    );
  }

  const data = integrationSnap.data().config || {};

  if (!data.server || !data.database || !data.user || !data.password) {
    throw new Error(
      `Config i pamjaftueshem per integrimin "${activeErpType}" per companyId="${companyId}". Duhen: server, database, user, password.`
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

  if (!instanceName && data.port) {
    config.port = data.port;
  }

  return config;
}

module.exports = { getErpConfig };