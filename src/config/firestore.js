const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    // credential: admin.credential.applicationDefault(), // default, nuk duhet e shkruar
  });
}

const db = admin.firestore();

// Rekomandim performance: settings për cache/undefined properties
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db };