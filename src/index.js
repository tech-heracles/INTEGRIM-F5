require('dotenv').config();
const express = require('express');
const syncRoutes = require('./routes/sync.route');
const { closeAllPools } = require('./config/sqlServerPool');

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.use('/sync', syncRoutes);

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`POS Sync Service duke degjuar ne port ${PORT}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM: duke mbyllur pools dhe server...');
  await closeAllPools();
  server.close(() => process.exit(0));
});