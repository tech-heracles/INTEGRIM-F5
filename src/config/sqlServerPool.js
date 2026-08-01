const sql = require('mssql');
const { getErpConfig } = require('../services/company.service');

// Cache i pool-eve ne memorie: { companyId: sql.ConnectionPool }
const poolCache = new Map();

async function getPoolForCompany(companyId) {
  if (poolCache.has(companyId)) {
    const existing = poolCache.get(companyId);
    if (existing.connected) return existing;
    poolCache.delete(companyId);
  }

  const config = await getErpConfig(companyId);
  const pool = new sql.ConnectionPool(config);

  pool.on('error', (err) => {
    console.error(`[SQL Pool Error] company=${companyId}`, err.message);
    poolCache.delete(companyId);
  });

  await pool.connect();
  poolCache.set(companyId, pool);
  return pool;
}

async function closeAllPools() {
  for (const [companyId, pool] of poolCache.entries()) {
    try {
      await pool.close();
    } catch (e) {
      console.error(`Gabim duke mbyllur pool per ${companyId}:`, e.message);
    }
  }
  poolCache.clear();
}

module.exports = { getPoolForCompany, closeAllPools, sql };