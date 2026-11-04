# Bin Mania membership

A mobile-web loyalty membership for [Bin Mania](https://binmaniastores.com/). People sign up, pay a monthly fee, add a selfie, and get a digital membership card with a rotating QR code. Staff sign in as **admins** (fee, offers, members, staff, settings) or **cashiers** (scan membership cards, nothing else).

Node + Express with a MySQL database, and plain HTML/CSS/JS in `public/` (no build step). Payments are simulated until Stripe is connected.

## Run it locally

Needs Node 22.9 or newer and a MySQL 8 server.

1. Make a database and a user for the app:

   ```sql
   CREATE DATABASE binmania CHARACTER SET utf8mb4;
   CREATE USER 'binmania'@'localhost' IDENTIFIED BY 'a-password';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON binmania.* TO 'binmania'@'localhost';
   ```

2. Put the connection in a `.env` file in this folder (it is not committed):

   ```
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=binmania
   DB_PASSWORD=a-password
   DB_NAME=binmania
   ```

3. Start it:

   ```
   npm install
   npm start
   ```

The first start creates the tables and the admin login, prints the login, and saves it in `data/admin-login.txt`. Open http://localhost:4090. To try it on a phone, connect the phone to the same Wi-Fi and open the "on your network" address the server prints.

To bring in data from the JSON prototype (`data/db.json` and `data/uploads`), stop the app and run `npm run import-json -- data`. It refuses to run if the database already has users; add `--replace` to wipe the database first.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | | `mysql://user:pass@host:3306/name`, instead of the five `DB_` settings |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `127.0.0.1`, `3306`, `binmania`, none, `binmania` | MySQL connection |
| `DB_SSL` | off | `true` requires TLS to MySQL (for a database on another machine) |
| `NODE_ENV` | | `production` turns on the production rules below |
| `PUBLIC_ORIGIN` | the request's own address | The site's address, e.g. `https://binmania.startwithdata.com`. Required in production |
| `COOKIE_SECURE` | on in production | Session cookie only over https |
| `TRUST_PROXY` | off | Behind a reverse proxy, which proxies to trust (Express `trust proxy`, e.g. `uniquelocal`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin@binmania.local` and a generated password | The first admin, made when the database has none. Required in production |
| `PORT`, `HOST` | `4090`, `0.0.0.0` | Where the server listens |

## Logins and roles

Everyone signs in on the same page and lands where their role belongs.

| Role | Gets in by | Can |
| --- | --- | --- |
| Member | Signing up | Their card, offers and billing |
| Cashier | An admin adds them | Scan membership cards. Nothing else |
| Admin | An admin adds them (the first comes from `ADMIN_EMAIL`) | Offers, members, checking codes, staff, settings |

**Admin → Staff** adds a cashier or admin and shows a temporary password once, to pass on. At their first sign-in they must choose their own (10+ characters for cashiers, 12+ for admins) before they can do anything else. The same page makes a new temporary password for someone who forgot theirs, or removes them. Both sign the person out everywhere at once. An admin can't remove themselves, so there is always one admin.

Anyone signed in can change their password from the menu, which signs them out on their other devices.

## What a member sees

1. **Sign-up page**: program name, monthly price and perks (all set by the admin).
2. **Create account**: name, email, optional mobile, password.
3. **Payment**: in demo mode, a card form that pretends to charge. Only the brand, last four digits and expiry reach the server. With demo mode off, sign-up shows "opens soon".
4. **Selfie**: opens the front camera on phones. The photo is cropped square, shrunk on the phone, and stored in the database.
5. **The app**, with a side menu of three pages:
   - **Offers**: the admin's posts, newest first, each with its time. New posts get a badge.
   - **My Membership**: the card with their selfie, member number, status and the rotating QR code.
   - **Billing**: plan, next payment, card on file (update it), payment history, cancel or keep membership.

## The rotating code

A code looks like `BM1.<member number>.<time window>.<signature>`. The signature is an HMAC keyed with a secret only the server knows, so the phone cannot make future codes. The phone asks the server for the current code every few seconds.

- The code changes every 20 seconds (admin can pick 10–60).
- A code is accepted during its own window and the one after, so a code that changes mid-scan still works. After that it is "expired".
- Each code scans **once**, even if two registers scan it at the same moment. A second scan of the same code, or an older one, is refused as "already scanned". A screenshot sent to a friend fails.
- When a code is scanned, the member's screen shows "Scanned!" until the next code.

Web pages cannot block screenshots (only native apps can, and only on Android). The card makes screenshots useless instead: codes expire and work once. It also makes a still image easy to spot. A light sweeps across the card, the clock ticks every second, and the code is hidden while the page is in the background. Long-press saving and printing are turned off, and the screen stays awake while the card is open.

## Checking codes (cashiers, admins and the future POS)

**Scan cards** (cashiers) or **Check a code** (admins): scan with the camera (Chrome on Android over https), use a USB barcode scanner, or type or paste a code. The result shows the member's photo to compare with the person. Admin → Members shows when each member was last scanned and by whom.

**POS endpoint**, for when the register is connected. It is off until an admin makes a key in **Admin → Settings**. The key is shown once, when made; only a hash is stored.

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
    "selfieUrl": "https://binmania.startwithdata.com/api/selfie/…?exp=…&sig=…"
  }
}
```

`reason` is one of `ok`, `expired`, `already_used`, `invalid`, `unknown_member`, `unreadable`, `inactive`. The selfie link works without a login for 5 minutes. After 20 wrong keys from one address in 15 minutes, that address gets `429` until the 15 minutes pass.

## Admin

- **Offers**: post a headline (optional), message and picture (optional). Delete posts.
- **Members**: counts, demo monthly revenue, search, each member's photo and billing details, and "Ask for a new selfie". Members can't change their own photo, so a card can't be passed to someone else by swapping it.
- **Check a code**: as above.
- **Staff**: as above.
- **Settings**: demo mode switch, program name, monthly fee, sign-up perks, code rotation time, POS key.

Changing the fee applies to new members. Current members keep the price they joined at, as Stripe does.

## Security

- **Sessions** are random tokens in an HttpOnly, SameSite=Lax cookie; the database keeps only a hash. In production the cookie is `__Host-` prefixed and Secure. Sign-out ends the session on the server. Staff sessions last 12 hours, members' 30 days.
- **Passwords** are hashed with scrypt (N=2^14, r=8, p=5). Older hashes are upgraded when the person signs in. Sign-in takes the same time whether or not the email has an account.
- **Limits**: 10 wrong passwords per email and address, and 50 sign-ins per address, every 15 minutes; 20 sign-ups per address per hour; 10 password-change attempts per person per 15 minutes. They are counted in memory, which suits one app container.
- **Cross-site requests**: every write must carry this site's own `Origin` (`PUBLIC_ORIGIN` in production), on top of SameSite cookies.
- **Headers**: a strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, `nosniff`, same-origin opener and resource policies, `no-store` on every API response. HSTS is set by Caddy.
- **Uploads**: photos are checked to really be JPEG, PNG or WebP, up to 4 MB. Only the two upload routes accept bodies over 64 KB.
- **Database**: every change to a member's billing, photo or scans locks their row, so two requests at once can't renew a period twice or accept a code twice. The app's MySQL user needs rights on its own database only.
- **Audit log**: sign-ins (and failed ones), sign-outs, password changes, staff changes, settings changes, POS keys, offers, selfie resets and every code check (who, what, when, from where) go to the `audit_log` table.
- **Production checks**: with `NODE_ENV=production` the server refuses to start without an https `PUBLIC_ORIGIN` and a database password. The first admin must come from `ADMIN_EMAIL`/`ADMIN_PASSWORD` and must choose a new password at first sign-in.

## Deploy

The app runs on its own server, in Docker, from `/opt/binmania`. `docker-compose.yml` runs four containers:

| Container | What it does |
| --- | --- |
| `caddy` | https on ports 80 and 443. Gets a free Let's Encrypt certificate for `SITE_DOMAIN`, renews it, and sends http to https |
| `app` | The membership app, reachable only through Caddy. Read-only file system, no Linux capabilities, health check on `/healthz` |
| `db` | MySQL 8.4, on a private Docker network the internet can't reach. Data in the `binmania_mysql` volume |
| `backup` | Dumps the database when it starts and every 24 hours into `/opt/binmania/backups`, keeping `BACKUP_KEEP_DAYS` days |

**It looks after itself.** Every container restarts if it stops, and Docker starts at boot, so the whole stack comes back after a reboot. After a reboot the app waits for MySQL to be ready. If the database stays unreachable for 2 minutes while running, the app exits so Docker restarts it. Container logs are capped at 50 MB each.

### First setup

1. Point the domain's DNS (an A record) at the server.
2. On the server, as root, run `deploy/setup-server.sh` once. It installs Docker and starts it at boot, allows only SSH, http and https through the firewall, and turns on automatic security updates.
3. Copy the app to `/opt/binmania` (see below), then in that folder: `cp .env.example .env`, `chmod 600 .env`, and fill it in. `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` should be long random values (`openssl rand -base64 24`).
4. `docker compose up -d --build`. Caddy gets the certificate within a minute; `docker compose ps` shows everything healthy.

On an empty database, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` for the first start. Sign in, choose a new password, then delete `ADMIN_PASSWORD` from `.env`.

### Moving the prototype's data over

The JSON prototype at binmania.startwithdata.com keeps its data in the `binmania-loyalty_binmania_data` volume on the old server. Before the first `docker compose up` on the new server:

1. Copy it across: on the old server, `docker run --rm -v binmania-loyalty_binmania_data:/d alpine tar -C /d -cz . > binmania-data.tgz`; then extract that into `/opt/binmania/import` on the new server.
2. `docker compose up -d db`, and wait until `docker compose ps` shows it healthy.
3. `docker compose run --rm -v ./import:/old:ro app node scripts/import-json.js /old`
4. `docker compose up -d --build`, then delete the `import` folder.

Members keep their logins, cards and photos, and everyone signs in once more. Admins must choose a new password at their next sign-in. The POS needs a new key from Settings.

### Ship a new version

From this folder on a PC with the server's SSH key:

```
git -c core.autocrlf=false archive HEAD | ssh root@<server> "tar -x -C /opt/binmania"
ssh root@<server> "cd /opt/binmania && docker compose up -d --build"
```

Only the app container is rebuilt and restarted, in a few seconds. Database changes apply on start (`lib/migrations.js`).

### Day to day

- Status: `docker compose ps`. Logs: `docker compose logs -f app` (or `caddy`, `db`, `backup`).
- Restore a backup: `gunzip -c backups/binmania-<date>.sql.gz | docker compose exec -T db sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`
- The backups sit on the same server. Copy them somewhere else too (another server, or cloud storage) so a lost server doesn't take them with it.

## Not done yet

- **Stripe**: nothing is charged. `lib/billing.js` is shaped like Stripe subscriptions, so the swap is: Stripe Checkout for the sign-up payment, the Customer Portal for Billing, and webhooks to set each member's status. Renewals are simulated when a member's period ends.
- **Password reset by email** for members, and email receipts. Staff passwords are reset by an admin.
- **Off-site backup copies** and uptime monitoring.
