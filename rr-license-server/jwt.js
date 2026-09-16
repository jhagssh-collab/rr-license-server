/* ============================================================================
   jwt.js — minimal RS256 JWT sign + verify using only Node's built-in
   `crypto` module. No `jsonwebtoken` npm package needed.

   Why hand-roll this instead of using the jsonwebtoken package:
   - One less dependency on both the server AND the desktop app.
   - The desktop app only ever needs `verify()` (it has the PUBLIC key),
     never `sign()` (it never has the PRIVATE key) — keeping this file
     identical on both sides makes that boundary obvious and auditable.

   Token format is standard JWT: base64url(header).base64url(payload).base64url(signature)
   Algorithm is fixed to RS256 (RSA-SHA256) — do not accept "alg":"none" or
   HMAC algorithms, which is a classic JWT-library vulnerability.
   ============================================================================ */

const crypto = require('crypto');

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerPart = b64url(JSON.stringify(header));
  const payloadPart = b64url(JSON.stringify(payload));
  const signingInput = headerPart + '.' + payloadPart;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), {
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });
  const signaturePart = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return signingInput + '.' + signaturePart;
}

/**
 * Returns { valid: boolean, payload: object|null, reason: string|null }
 * Never throws — always safe to call on untrusted input.
 */
function verify(token, publicKeyPem) {
  try {
    if (typeof token !== 'string') return { valid: false, payload: null, reason: 'not-a-string' };
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, payload: null, reason: 'malformed' };
    const [headerPart, payloadPart, signaturePart] = parts;

    const header = JSON.parse(b64urlDecode(headerPart).toString('utf8'));
    if (header.alg !== 'RS256') return { valid: false, payload: null, reason: 'unsupported-alg' };

    const signingInput = headerPart + '.' + payloadPart;
    const signature = Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(signingInput),
      { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
      signature
    );
    if (!ok) return { valid: false, payload: null, reason: 'bad-signature' };

    const payload = JSON.parse(b64urlDecode(payloadPart).toString('utf8'));

    if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) {
      return { valid: false, payload, reason: 'expired' };
    }

    return { valid: true, payload, reason: null };
  } catch (e) {
    return { valid: false, payload: null, reason: 'exception:' + e.message };
  }
}

module.exports = { sign, verify };
