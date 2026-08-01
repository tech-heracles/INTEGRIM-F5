const path = require('path');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let app;

if (!getApps().length) {
  const serviceAccount = require(path.join(__dirname, '..', '..', 'serviceAccountKey.json'));

  app = initializeApp({
    credential: cert(serviceAccount),
  });
} else {
  app = getApps()[0];
}

const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

module.exports = { db };