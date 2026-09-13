const express = require('express');
const sql = require('mssql');

const router = express.Router();

// Test i thjeshte lidhjeje me SQL Server, i pavarur nga Firestore: klienti
// (Manager app) dergon config-un qe ka ne form (i ruajtur ose jo ende), sepse
// kjo rrugesire xhiron ne te njejtin rrjet me SQL Server-in e Financa5 -
// ndryshe nga Cloud Functions qe s'kane asnje rruge rrjeti drejt tij.
router.post('/test-connection', async (req, res) => {
  const { server, database, user, password, encrypt, trustServerCertificate, port } = req.body || {};

  if (!server || !database || !user || !password) {
    return res.status(400).json({
      ok: false,
      error: 'Mungojne fusha te detyrueshme: server, database, user, password.',
    });
  }

  let serverHost = server;
  let instanceName;

  if (server.includes('\\')) {
    const parts = server.split('\\');
    serverHost = parts[0] === '' || parts[0] === '.' ? 'localhost' : parts[0];
    instanceName = parts[1];
  }

  const poolConfig = {
    server: serverHost,
    database,
    user,
    password,
    options: {
      encrypt: encrypt ?? false,
      trustServerCertificate: trustServerCertificate ?? true,
      ...(instanceName ? { instanceName } : {}),
    },
    connectionTimeout: 8000,
    requestTimeout: 8000,
    pool: { max: 1, min: 0, idleTimeoutMillis: 5000 },
  };

  if (!instanceName && port) {
    poolConfig.port = port;
  }

  let pool;
  try {
    pool = new sql.ConnectionPool(poolConfig);
    await pool.connect();
    await pool.request().query('SELECT 1 AS ok');
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[TestConnectionError]', err.message);
    res.status(200).json({ ok: false, error: err.message });
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch {
        // ignore close errors
      }
    }
  }
});

module.exports = router;
