/* ============================================================================
   db.js — tiny JSON-file database. No native modules (no better-sqlite3 /
   sqlite3), so it deploys anywhere Node runs (Render, Railway, a plain VPS)
   without worrying about native-build failures. Fine for the scale of a
   single-product license list (hundreds to low thousands of keys).

   Data shape (data.json):
   {
     "keys": {
       "<licenseKey>": {
         "status": "unused" | "active" | "revoked",
         "deviceId": null | "<fingerprint>",
         "plan": "lifetime",
         "createdAt": ISOString,
         "activatedAt": null | ISOString,
         "note": "customer name/email, optional",
         "transferRequested": false
       }
     }
   }

   Writes are serialized through a promise chain so concurrent requests
   never interleave and corrupt the file.
   ============================================================================ */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');

function loadSync() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { keys: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('data.json is corrupted / not valid JSON: ' + e.message);
  }
}

let state = loadSync();
let writeQueue = Promise.resolve();

function persist() {
  writeQueue = writeQueue.then(() =>
    fsp.writeFile(DB_PATH, JSON.stringify(state, null, 2), 'utf8')
  );
  return writeQueue;
}

module.exports = {
  getKey(licenseKey) {
    return state.keys[licenseKey] || null;
  },
  listKeys() {
    return Object.entries(state.keys).map(([licenseKey, v]) => ({ licenseKey, ...v }));
  },
  async createKey(licenseKey, note) {
    state.keys[licenseKey] = {
      status: 'unused',
      deviceId: null,
      plan: 'lifetime',
      createdAt: new Date().toISOString(),
      activatedAt: null,
      note: note || '',
      transferRequested: false,
    };
    await persist();
    return state.keys[licenseKey];
  },
  async bindDevice(licenseKey, deviceId) {
    const rec = state.keys[licenseKey];
    if (!rec) return null;
    rec.status = 'active';
    rec.deviceId = deviceId;
    rec.activatedAt = new Date().toISOString();
    rec.transferRequested = false;
    await persist();
    return rec;
  },
  async revokeKey(licenseKey) {
    const rec = state.keys[licenseKey];
    if (!rec) return null;
    rec.status = 'revoked';
    await persist();
    return rec;
  },
  async requestTransfer(licenseKey) {
    const rec = state.keys[licenseKey];
    if (!rec) return null;
    rec.transferRequested = true;
    await persist();
    return rec;
  },
  async approveTransfer(licenseKey) {
    const rec = state.keys[licenseKey];
    if (!rec) return null;
    rec.status = 'unused';
    rec.deviceId = null;
    rec.transferRequested = false;
    await persist();
    return rec;
  },
};
