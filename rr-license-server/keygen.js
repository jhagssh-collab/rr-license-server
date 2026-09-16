/* ============================================================================
   keygen.js — run this ONCE to generate the RSA keypair used for license
   token signing/verification.

       node keygen.js

   Produces two files in this folder:
     private.pem   -> KEEP SECRET. Stays only on the license server. Used to
                       sign license tokens. NEVER put this inside the
                       Electron app or commit it to a public repo.
     public.pem    -> Safe to be public. This gets pasted into the desktop
                       app's license-manager.js so the app can VERIFY tokens
                       offline without being able to CREATE fake ones.

   If private.pem / public.pem already exist, this script refuses to
   overwrite them (so you don't accidentally invalidate every license
   you've already issued). Delete them yourself first if you really want
   a fresh keypair.
   ============================================================================ */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const privPath = path.join(__dirname, 'private.pem');
const pubPath = path.join(__dirname, 'public.pem');

if (fs.existsSync(privPath) || fs.existsSync(pubPath)) {
  console.error('private.pem or public.pem already exists in this folder.');
  console.error('Refusing to overwrite. Delete them manually first if you are sure.');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
fs.writeFileSync(pubPath, publicKey);

console.log('Keypair generated.');
console.log('  private.pem ->', privPath, '(KEEP SECRET, server-only)');
console.log('  public.pem  ->', pubPath, '(paste contents into desktop app)');
console.log('');
console.log('Next steps:');
console.log('  1. Keep private.pem on the license server only (or set it as');
console.log('     the LICENSE_PRIVATE_KEY environment variable, see README.md).');
console.log('  2. Copy the FULL contents of public.pem (including the');
console.log('     -----BEGIN/END PUBLIC KEY----- lines) into');
console.log('     rr-desktop-app/license-manager.js, replacing the');
console.log('     PUBLIC_KEY_PEM placeholder.');
