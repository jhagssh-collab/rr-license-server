/* ============================================================================
   server.js — License activation API for REHMAN RAJPUT Video Editor.

   Run:
       node keygen.js        (once, to create private.pem / public.pem)
       ADMIN_SECRET=some-long-random-string node server.js

   Env vars:
     PORT               default 4000
     ADMIN_SECRET       required — protects all /admin/* endpoints
     LICENSE_PRIVATE_KEY  optional — PEM string. If not set, reads private.pem
                           from this folder instead.
     TOKEN_TTL_DAYS     default 36500 (~100 years = "lifetime" once activated,
                         so the desktop app never needs to phone home again)

   Endpoints:
     POST /api/activate        { licenseKey, deviceId }  -> { token }
     POST /api/validate        { token }                 -> { valid, reason }
     POST /api/request-transfer{ licenseKey }             -> { ok }  (customer
                                                                asks to move
                                                                their license
                                                                to a new PC)

     Admin (require header  x-admin-secret: <ADMIN_SECRET>):
     GET  /admin/keys                       -> list all keys
     POST /admin/keys           { note }    -> creates + returns a new key
     POST /admin/keys/:key/revoke           -> revoke a key
     POST /admin/keys/:key/approve-transfer -> unbind device, key becomes
                                                reusable on a new machine
     GET  /admin/                           -> simple HTML admin panel
   ============================================================================ */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const jwt = require('./jwt');

   const PORT = process.env.PORT || 8080;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const TOKEN_TTL_DAYS = Number(process.env.TOKEN_TTL_DAYS) || 36500;

if (!ADMIN_SECRET) {
  console.error('FATAL: set the ADMIN_SECRET environment variable before starting the server.');
  console.error('Example:  ADMIN_SECRET=$(openssl rand -hex 24) node server.js');
  process.exit(1);
}

function loadPrivateKey() {
  if (process.env.LICENSE_PRIVATE_KEY) return process.env.LICENSE_PRIVATE_KEY;
  const p = path.join(__dirname, 'private.pem');
  if (!fs.existsSync(p)) {
    console.error('FATAL: private.pem not found. Run `node keygen.js` first, or set LICENSE_PRIVATE_KEY.');
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}
const PRIVATE_KEY = loadPrivateKey();

function loadPublicKey() {
  const p = path.join(__dirname, 'public.pem');
  if (!fs.existsSync(p)) {
    console.error('FATAL: public.pem not found. Run `node keygen.js` first.');
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}
const PUBLIC_KEY = loadPublicKey();

const app = express();
app.use(express.json({ limit: '64kb' }));

// ---- basic per-IP rate limiting (no dependency needed) --------------------
const rateBuckets = new Map();
function rateLimit(maxPerMinute) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - 60_000;
    const hits = (rateBuckets.get(ip) || []).filter(t => t > windowStart);
    hits.push(now);
    rateBuckets.set(ip, hits);
    if (hits.length > maxPerMinute) {
      return res.status(429).json({ error: 'Too many requests, slow down.' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-secret'];
  if (!provided || provided !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function generateLicenseKey() {
  // Format: RR-XXXX-XXXX-XXXX-XXXX (uppercase hex, easy to read/type)
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `RR-${seg()}-${seg()}-${seg()}-${seg()}`;
}

// ---------------------------------------------------------------------------
// Public: activation
// ---------------------------------------------------------------------------
app.post('/api/activate', rateLimit(20), async (req, res) => {
  const { licenseKey, deviceId } = req.body || {};
  if (!licenseKey || !deviceId) {
    return res.status(400).json({ error: 'licenseKey and deviceId are required' });
  }
  const rec = db.getKey(String(licenseKey).trim().toUpperCase());
  const key = String(licenseKey).trim().toUpperCase();

  if (!rec) return res.status(404).json({ error: 'License key not found' });
  if (rec.status === 'revoked') return res.status(403).json({ error: 'This license has been revoked' });

  if (rec.status === 'active' && rec.deviceId && rec.deviceId !== deviceId) {
    return res.status(409).json({
      error: 'This license is already activated on a different device. ' +
             'Use /api/request-transfer and ask the vendor to approve a transfer.',
    });
  }

  const bound = await db.bindDevice(key, deviceId);

  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      licenseKey: key,
      deviceId,
      plan: bound.plan,
      iat: now,
      exp: now + TOKEN_TTL_DAYS * 24 * 60 * 60,
    },
    PRIVATE_KEY
  );

  console.log(`[activate] ${key} -> device ${deviceId.slice(0, 12)}...`);
  res.json({ token });
});

// ---------------------------------------------------------------------------
// Public: optional online re-validation (revocation check). The desktop app
// works fully offline using the signed token's expiry, but can optionally
// call this if you want revoked keys to stop working even mid-license.
// ---------------------------------------------------------------------------
app.post('/api/validate', rateLimit(60), (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ valid: false, reason: 'missing-token' });

  const result = jwt.verify(token, PUBLIC_KEY);
  if (!result.valid) return res.json({ valid: false, reason: result.reason });

  const rec = db.getKey(result.payload.licenseKey);
  if (!rec || rec.status === 'revoked') return res.json({ valid: false, reason: 'revoked' });
  if (rec.deviceId !== result.payload.deviceId) return res.json({ valid: false, reason: 'device-mismatch' });

  res.json({ valid: true });
});

app.post('/api/request-transfer', rateLimit(10), async (req, res) => {
  const { licenseKey } = req.body || {};
  if (!licenseKey) return res.status(400).json({ error: 'licenseKey required' });
  const key = String(licenseKey).trim().toUpperCase();
  const rec = await db.requestTransfer(key);
  if (!rec) return res.status(404).json({ error: 'License key not found' });
  console.log(`[transfer-request] ${key}`);
  res.json({ ok: true, message: 'Transfer requested. Ask the vendor to approve it in the admin panel.' });
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
app.get('/admin/keys', requireAdmin, (req, res) => {
  res.json(db.listKeys());
});

app.post('/admin/keys', requireAdmin, async (req, res) => {
  const note = (req.body && req.body.note) || '';
  let key;
  do { key = generateLicenseKey(); } while (db.getKey(key));
  const rec = await db.createKey(key, note);
  res.json({ licenseKey: key, ...rec });
});

app.post('/admin/keys/:key/revoke', requireAdmin, async (req, res) => {
  const rec = await db.revokeKey(req.params.key.toUpperCase());
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, ...rec });
});

app.post('/admin/keys/:key/approve-transfer', requireAdmin, async (req, res) => {
  const rec = await db.approveTransfer(req.params.key.toUpperCase());
  if (!rec) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, ...rec });
});

// The admin PAGE (the HTML shell) is served without auth, because a plain
// browser GET can't attach the x-admin-secret header. The page itself is
// just a login form + JS — it asks for the secret and puts it in every
// fetch() call as the x-admin-secret header. No key data is embedded in the
// HTML, so nothing leaks until someone enters the correct secret and the
// real /admin/keys API (which IS protected by requireAdmin) accepts it.
app.get('/admin/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin', (req, res) => res.redirect('/admin/'));

app.get('/', (req, res) => {
  res.type('text/plain').send('REHMAN RAJPUT license server is running.');
});

app.listen(PORT, () => {
  console.log('============================================================');
  console.log(' RR License Server listening on port ' + PORT);
  console.log(' Admin panel: http://localhost:' + PORT + '/admin/  (needs ADMIN_SECRET)');
  console.log('============================================================');
});
