const express = require('express');
const { syncItems } = require('../services/itemSync.service');
const { syncItemCategories } = require('../services/itemCategorySync.service');
const { syncItemGroups } = require('../services/itemGroupSync.service');
const { syncCustomers } = require('../services/customerSync.service');

const router = express.Router();

router.post('/items/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const fullSync = Boolean(req.body?.full);

  try {
    const result = await syncItems(companyId, fullSync);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(`[SyncError] company=${companyId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/item-categories/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const fullSync = Boolean(req.body?.full);

  try {
    const result = await syncItemCategories(companyId, fullSync);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(`[SyncError] company=${companyId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/item-groups/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const fullSync = Boolean(req.body?.full);

  try {
    const result = await syncItemGroups(companyId, fullSync);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(`[SyncError] company=${companyId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/customers/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const fullSync = Boolean(req.body?.full);

  try {
    const result = await syncCustomers(companyId, fullSync);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(`[SyncError] company=${companyId}`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;