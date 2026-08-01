const express = require('express');
const { ensureDateEditColumns } = require('../services/schemamigration.service');

const router = express.Router();

// Body: { tables: ["KLIENT", { tableName: "ARTIKUJ", keyColumn: "KODI" }], dryRun: true }
router.post('/ensure-dateedit/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { tables, dryRun } = req.body || {};

  if (!Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Duhet nje array "tables" me te pakten nje emer tabele (ose { tableName, keyColumn }).',
    });
  }

  try {
    const results = await ensureDateEditColumns(companyId, tables, Boolean(dryRun));
    res.status(200).json({ ok: true, companyId, dryRun: Boolean(dryRun), results });
  } catch (err) {
    console.error(`[SchemaMigrationError] company=${companyId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;