# RR License Server

Chhota Express API jo aapke Electron desktop app ke liye license keys issue,
verify, revoke aur transfer karta hai. SQLite ki jagah ek simple `data.json`
file store use hoti hai — koi native module compile nahi karna padta, isliye
kisi bhi free-tier host (Render, Railway) ya saste VPS par bina kisi issue
ke deploy ho jata hai.

## 1. Setup (ek dafa)

```bash
npm install
node keygen.js
```

Ye `private.pem` aur `public.pem` banayega. **`private.pem` kabhi bhi kahin
share mat karo, Electron app mein mat daalo, GitHub par push mat karo.**
Sirf is server par rahega.

`public.pem` ki poori content copy karke `rr-desktop-app/license-manager.js`
mein `PUBLIC_KEY_PEM` placeholder ki jagah paste karo — yeh file desktop app
ke saath ship hoti hai aur sirf signature *verify* kar sakti hai, naya
license *bana* nahi sakti.

## 2. Admin secret set karo aur server chalao

```bash
export ADMIN_SECRET=$(openssl rand -hex 24)
echo $ADMIN_SECRET   # ye kahin safe jagah save kar lo, admin panel login ke liye chahiye hoga
npm start
```

Server `http://localhost:4000` par chalega. Admin panel:
`http://localhost:4000/admin/`

## 3. Deploy kahan karein

Koi bhi jagah jahan Node.js chal sake:

- **Render.com / Railway.app (free tier)** — repo connect karo, build command
  `npm install`, start command `npm start`, environment variables mein
  `ADMIN_SECRET` set karo. `private.pem` ko environment variable
  `LICENSE_PRIVATE_KEY` mein poori PEM string ke taur par paste kar sakte ho
  (agar file-based deploy uncomfortable lage), server dono support karta
  hai.
- **Koi bhi VPS** — `git clone` ya files upload karo, `npm install`,
  `pm2 start server.js` (ya systemd service) se background mein chalao.

**Zaroori:** production mein HTTPS ke peeche hona chahiye (Render/Railway
khud HTTPS dete hain; apne VPS par ho to Caddy/Nginx + Let's Encrypt laga
lo), warna license key network par plain-text jaa sakti hai.

## 4. License keys generate karna

Admin panel (`/admin/`) khol kar `ADMIN_SECRET` daalo, "Generate New Key"
button dabao. Format: `RR-XXXX-XXXX-XXXX-XXXX`. Ye key customer ko do — wahi
key woh Electron app ke activation screen mein daalega.

## 5. Kya hota hai activation par

1. Customer app kholta hai, license key daalta hai.
2. App uska hardware fingerprint (`deviceId`) nikaal kar
   `POST /api/activate` bhejta hai.
3. Server check karta hai key exist karti hai, revoked nahi hai, aur
   (agar pehle kisi aur device par activate ho chuki hai) same device hai.
4. Server ek **signed token** (RS256, private key se sign hota hai) wapas
   bhejta hai jisme `licenseKey`, `deviceId`, aur expiry hoti hai.
5. App wo token local disk par save kar leta hai. Ab se app **poori tarah
   offline chal sakta hai** — token ki signature sirf public key se verify
   hoti hai, internet nahi chahiye.

Token ki default expiry ~100 saal hai (`TOKEN_TTL_DAYS` env var se badal
sakte ho) — matlab practically "lifetime" jaisa hi hai.

## 6. Device change / naya PC

Agar customer ka PC change ho ya format ho jaye, unka fingerprint badal
jayega aur wahi purani key doosre PC par activate nahi hogi (409 error
milega, "already activated on different device"). Customer app se hi
"Request Transfer" bhej sakta hai (`POST /api/request-transfer`), phir aap
admin panel mein us key ke saamne "Approve transfer / unbind" dabao — ab
woh key kisi bhi naye device par dobara activate ho sakti hai.

## 7. Security notes (honest)

- License **validate** hona (signature + expiry check) crack-proof hai
  kyunki aapke paas private key hai — koi bhi fake token forge nahi kar
  sakta.
- Lekin **check karna ki app validate ho raha hai** — ye logic khud
  Electron app ke JS code mein hai. Ek skilled developer `app.asar` khol
  kar us check ko delete/bypass kar sakta hai. Yeh koi bhi purely-local
  license system ki fundamental limitation hai (isko desktop-app README mein
  detail se explain kiya hai).
- `ADMIN_SECRET` ko strong rakho aur kabhi client-side code mein mat likho.
- `data.json` ka regular backup rakho (isme saari keys aur activations hain).
