require('dotenv').config();
const express = require('express');
const syncRoutes = require('./routes/sync.route');
const schemaRoutes = require('./routes/schema.route');
const erpRoutes = require('./routes/erp.route');
const { closeAllPools } = require('./config/sqlServerPool');

const app = express();

// Manager app calls this service from a browser (Flutter web) on a
// different origin/port, so the CORS preflight (OPTIONS) needs a response
// before express.json() even sees the real request.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.use('/sync', syncRoutes);
app.use('/schema', schemaRoutes);
app.use('/erp', erpRoutes);

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`POS Sync Service duke degjuar ne port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM: duke mbyllur pools dhe server...');
  await closeAllPools();
  server.close(() => process.exit(0));
});