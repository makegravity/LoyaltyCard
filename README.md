# Bin Mania membership (prototype)

A mobile-web loyalty membership for [Bin Mania](https://binmaniastores.com/). People sign up, pay a monthly fee, add a selfie, and get a digital membership card with a rotating QR code. An admin login sets the fee, posts offers, sees members, and checks codes.

Standalone: Node + Express, a JSON file for data, and plain HTML/CSS/JS in `public/` (no build step).

Live at https://binmania.startwithdata.com (see [Deploy](#deploy)).

## Run it

Needs Node 18 or newer (tested on 22).

```
npm install
npm start
```

Open http://localhost:4090. To try it on a phone, connect the phone to the same Wi-Fi and open the "on your network" address the server prints (for example `http://192.168.4.22:4090`).

The first start creates the admin login and prints it. It is also saved in `data/admin-login.txt`. To pick your own, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first start.

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `4090` | Port to listen on |
| `HOST` | `0.0.0.0` | `127.0.0.1` keeps it to this PC |
| `DATA_DIR` | `./data` | Where `db.json`, photos, the admin login and the signing key live |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@binmania.local` / generated | First-run admin login |
| `SESSION_SECRET` | generated into `data/secret.key` | Signs session cookies and photo links |
| `TRUST_PROXY` | off | Behind a reverse proxy, which proxies to trust (Express `trust proxy`, for example `uniquelocal`) |

Delete the `data` folder to start over (this removes every member and photo).

## What a member sees

1. **Sign-up page**: program name, monthly price and perks (all set by the admin).
2. **Create account**: name, email, optional mobile, password.
3. **Payment**: in demo mode, a card form that pretends to charge. Only the brand, last four digits and expiry reach the server. With demo mode off, sign-up shows "opens soon".
4. **Selfie**: opens the front camera on phones. The photo is cropped square, shrunk on the phone, and stored on the server in `data/uploads/selfies`.
5. **The app**, with a side menu of three pages:
   - **Offers**: the admin's posts, newest first, each with its time. New posts get a badge.
   - **My Membership**: the card with their selfie, member number, status and the rotating QR code.
   - **Billing**: plan, next payment, card on file (update it), payment history, cancel or keep membership.

## The rotating code

A code looks like `BM1.<member number>.<time window>.<signature>`. The signature is an HMAC keyed with a secret only the server knows, so the phone cannot make future codes. The phone asks the server for the current code every few seconds.

- The code changes every 20 seconds (admin can pick 10–60).
- A code is accepted during its own window and the one after, so a code that changes mid-scan still works. After that it is "expired".
- Each code scans **once**. A second scan of the same code, or an older one, is refused as "already scanned". A screenshot sent to a friend fails.
- When a code is scanned, the member's screen shows "Scanned!" until the next code.

Web pages cannot block screenshots (only native apps can, and only on Android). The card makes screenshots useless instead: codes expire and work once. It also makes a still image easy to spot. A light sweeps across the card, the clock ticks every second, and the code is hidden while the page is in the background. Long-press saving and printing are turned off, and the screen stays awake while the card is open.

## Checking codes (admin, and the future POS)

**Admin → Check a code**: type or paste a code, use a USB barcode scanner, or scan with the camera (Chrome on Android over https). The result shows the member's photo to compare with the person.

**POS endpoint**, for when the register is connected:

```
POST /api/pos/verify
X-POS-Key: <key from Admin → Settings>
Content-Type: application/json

{ "code": "BM1.100001.89656319.pg2mI-httFWY" }
```

The response:

```json
{
  "valid": true,
  "reason": "ok",
  "message": "Active member",
  "member": {
    "memberNumber": 100001,
    "name": "Jamie Carter",
    "status": "active",
    "memberSince": "2026-10-27T17:40:12.000Z",
    "selfieUrl": "http://…/api/selfie/…?exp=…&sig=…"
  }
}
```

`reason` is one of `ok`, `expired`, `already_used`, `invalid`, `unknown_member`, `unreadable`, `inactive`. The selfie link works without a login for 5 minutes.

## Admin

- **Offers**: post a headline (optional), message and picture (optional). Delete posts.
- **Members**: counts, demo monthly revenue, search, each member's photo and billing details, and "Ask for a new selfie". Members can't change their own photo, so a card can't be passed to someone else by swapping it.
- **Check a code**: as above.
- **Settings**: demo mode switch, program name, monthly fee, sign-up perks, code rotation time, POS key.

Changing the fee applies to new members. Current members keep the price they joined at, as Stripe does.

## Deploy

https://binmania.startwithdata.com runs on the shared internal-tools server, next to the other startwithdata.com apps:

- The app is the `binmania-loyalty` container, built from `/opt/binmania-loyalty` with `docker-compose.yml`. Its data is in the `binmania-loyalty_binmania_data` Docker volume, so rebuilding keeps every member and photo.
- The shared nginx (`/home/zpl_designer`) handles https and proxies to the container. Its server blocks are in `deploy/nginx.conf`, and the certbot container renews the certificate.

To ship a new version, from this folder on a PC with the server's SSH key:

```
git -c core.autocrlf=false archive HEAD | ssh root@binmania.startwithdata.com "tar -x -C /opt/binmania-loyalty"
ssh root@binmania.startwithdata.com "cd /opt/binmania-loyalty && docker compose up -d --build"
```

The live admin login is in the volume: `docker exec binmania-loyalty cat /app/data/admin-login.txt`.

## Not done yet (prototype)

- **Stripe**: nothing is charged. `lib/billing.js` is shaped like Stripe subscriptions, so the swap is: Stripe Checkout for the sign-up payment, the Customer Portal for Billing, and webhooks to set each member's status. Renewals are simulated when a member's period ends.
- **Password reset**, email receipts, and more than one admin.
- **Database**: data is one JSON file (`lib/store.js`). Fine for a demo; move to a real database before launch.
