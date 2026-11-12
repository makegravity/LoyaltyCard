# Bin Mania membership

A mobile-web loyalty membership for [Bin Mania](https://binmaniastores.com/). People sign up (online, or at the register), pay through Stripe, add a selfie, and get a digital membership card with a rotating QR code. Staff sign in as **cashiers** (scan cards, sign up members at the counter), **admins** (also offers, members, staff, settings) or **super admins** (also the Stripe keys, the plan and the payment mode).

Node + Express with a MySQL database, Stripe for card payments, and plain HTML/CSS/JS in `public/` (no build step).

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
| `PUBLIC_ORIGIN` | the request's own address | The site's address, e.g. `https://maniacrewards.com`. Required in production |
| `COOKIE_SECURE` | on in production | Session cookie only over https |
| `TRUST_PROXY` | off | Behind a reverse proxy, which proxies to trust (Express `trust proxy`, e.g. `uniquelocal`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | `admin@binmania.local` and a generated password | The first account (a super admin), made when the database has none. Required in production |
| `SECRETS_KEY` | derived from the database | 64 hex characters (`openssl rand -hex 32`) that encrypt the Stripe keys saved in Payments. Required in production |
| `FORGOT_EMAIL`, `FORGOT_EMAIL_APP_PASSWORD` | off | The mailbox that sends password reset links, and its password. For Gmail, an [app password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification). Without them, "Forgot password?" doesn't show |
| `SMTP_HOST`, `SMTP_PORT` | `smtp.gmail.com`, `465` | Only for a mail provider other than Gmail. Port 465 is TLS from the start; other ports must offer STARTTLS in production |
| `PORT`, `HOST` | `4090`, `0.0.0.0` | Where the server listens |

## Logins and roles

Everyone signs in on the same page and lands where their role belongs.

| Role | Gets in by | Can |
| --- | --- | --- |
| Member | Signing up, or a cashier signs them up | Their card, offers and billing |
| Cashier | An admin adds them | Scan membership cards, sign up new members at the counter |
| Admin | An admin adds them | Also offers, members, staff and settings |
| Super admin | The first account (from `ADMIN_EMAIL`), or another super admin adds them | Also **Payments**: Stripe keys, the plan new members join on, the payment mode |

**Admin → Staff** adds staff and shows a temporary password once, to pass on. At their first sign-in they must choose their own (8+ characters, like every password) before they can do anything else. The same page makes a new temporary password for someone who forgot theirs, or removes them. Both sign the person out everywhere at once. Only a super admin can add, reset or remove a super admin, and nobody can remove themselves. If there is ever no super admin, the longest-serving admin becomes one when the app starts.

Anyone signed in can change their password from the menu, which signs them out on their other devices.

**Forgot password?** on the sign-in page works for everyone, members and staff. They enter their email and get a link (from `FORGOT_EMAIL`) to choose a new password. The link works once, for an hour; using it signs them in there and out everywhere else, and clears a staff member's temporary password. The page says the same thing whether or not the email has an account. The server logs at start whether it could sign in to the mailbox.

## What a member sees

1. **Sign-up page**: program name, price and perks. With Stripe they come from the plan the super admin chose (product name, price and interval, and the product's features if it lists any); otherwise from Settings.
2. **Create account**: name, email, optional mobile, password.
3. **Payment**: Stripe's card form (it runs in Stripe's frame, so card numbers never reach this server; Apple Pay and Google Pay show where available). In demo mode, a card form that pretends to charge. With payments off, sign-up shows "opens soon".
4. **Selfie**: opens the front camera on phones. The photo is cropped square, shrunk on the phone, checked for a face on the server, and stored in the database.
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

## Payments

Super admins set payments up in **Payments** (menu → Payments). **Help** (also in their menu) explains how the site works, what each kind of login can do, setting up Stripe (including the permissions a restricted key needs), everyday tasks and troubleshooting. Payments shows sandbox and live in two tabs. Every change asks for their password again, which holds for 10 minutes.

| Mode | New sign-ups | Memberships that count |
| --- | --- | --- |
| Off | Closed | Live ones |
| Demo | Made-up cards, nothing charged | All |
| Sandbox | Stripe test mode: test cards, nothing charged | All |
| Live | Real cards, through Stripe | Live ones |

So going live ends every demo and sandbox membership at once, and live members keep working in every mode.

- **Keys**: a publishable key and a secret (or restricted) key per mode, checked with Stripe before they're saved. The secret key is encrypted with `SECRETS_KEY` and never shown again.
- **Webhook**: saving keys on an https site sets up a webhook in Stripe at `/api/stripe/webhook/sandbox` (or `/live`) for subscription, invoice, price and product events. Locally, use `stripe listen` and paste its signing secret.
- **Plan**: one of the account's recurring prices, chosen (or created) in Payments. New members join on it; current members keep the price they joined at. Name and price changes made in Stripe arrive by webhook.
- **Subscriptions** (`lib/payments.js`): the subscription is made when the member presses Pay, waits for the first payment, and the card form confirms it. Stripe renews; webhooks and a check after each period end keep our copy up to date. A failed renewal shows "Payment due" and the card keeps working while Stripe retries; updating the card retries at once. If nothing is heard from Stripe 3 days after a period ends, the card stops.
- **Billing**: members change their card, cancel or keep their membership; history lists each payment with Stripe's receipt.

## Signing up at the counter

**New member** (cashiers and admins): the customer's name, email, optional mobile and a photo, then the customer types their card into Stripe's form on the register's screen. Once paid, a QR code appears: the customer scans it with their phone, chooses a password, and their card opens there. The link works once, for 24 hours; **Members** shows who hasn't opened theirs yet and makes a new link. Until the customer signs in, staff can pick the same email up again (to retry a declined card or make a new link).

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
    "selfieUrl": "https://maniacrewards.com/api/selfie/…?exp=…&sig=…"
  }
}
```

`reason` is one of `ok`, `expired`, `already_used`, `invalid`, `unknown_member`, `unreadable`, `inactive`. The selfie link works without a login for 5 minutes. After 20 wrong keys from one address in 15 minutes, that address gets `429` until the 15 minutes pass.

## Admin

- **Offers**: post a headline (optional), message and picture (optional). Delete posts.
- **Members**: counts, monthly revenue, search, each member's photo, billing details and who signed them up at the counter, "Ask for a new selfie", and a new phone link for counter sign-ups. Members can't change their own photo, so a card can't be passed to someone else by swapping it.
- **New member**, **Check a code**, **Staff**: as above.
- **Settings**: the payment mode and plan (read-only; super admins change them in Payments), program name, the fee and perks used in demo mode, code rotation time, POS key.

## Security

- **Sessions** are random tokens in an HttpOnly, SameSite=Lax cookie; the database keeps only a hash. In production the cookie is `__Host-` prefixed and Secure. Sign-out ends the session on the server. Staff sessions last 12 hours, members' 30 days.
- **Passwords** are hashed with scrypt (N=2^14, r=8, p=5). Older hashes are upgraded when the person signs in. Sign-in takes the same time whether or not the email has an account.
- **Limits**: 10 wrong passwords per email and address, and 50 sign-ins per address, every 15 minutes; 20 sign-ups per address per hour; 10 password-change attempts per person per 15 minutes; 3 reset emails per email address and 20 per address per hour. They are counted in memory, which suits one app container.
- **Password reset links** are single-use 256-bit tokens, stored hashed, that expire after an hour. Asking for one gets the same answer whether or not the email has an account, without waiting for the email to go. The link is in the page's `#` part, so it never reaches server logs or other sites. Changing a password cancels any reset links still out.
- **Cross-site requests**: every write must carry this site's own `Origin` (`PUBLIC_ORIGIN` in production), on top of SameSite cookies.
- **Headers**: a strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, `nosniff`, same-origin opener and resource policies, `no-store` on every API response. HSTS is set by Caddy.
- **Uploads**: photos are checked to really be JPEG, PNG or WebP, up to 4 MB. Only the upload routes accept bodies over 64 KB.
- **Card photos** (member selfies and counter photos) must show one clear face: `lib/faces.js` runs the UltraFace detector (`models/`, MIT licence) on the server in about 60–150 ms, and refuses a photo with no face, a face too small to recognise, or a second person just as clear. The counter checks the photo as soon as it's taken. If the detector itself fails, photos are let through and the failure is logged.
- **Payments**: card details go straight from the browser to Stripe. Stripe keys are encrypted at rest; changing them, the plan or the mode needs a fresh password confirmation. Webhooks are accepted only with a valid Stripe signature, and every event is checked by fetching the subscription from Stripe. Counter sign-up links are single-use 256-bit tokens, stored hashed.
- **Database**: every change to a member's billing, photo or scans locks their row, so two requests at once can't renew a period twice or accept a code twice. The app's MySQL user needs rights on its own database only.
- **Audit log**: sign-ins (and failed ones), sign-outs, password changes, reset emails asked for and used, staff changes, settings changes, Stripe key, plan and mode changes, sign-ups and payments, counter sign-ups and links, POS keys, offers, selfie resets and every code check (who, what, when, from where) go to the `audit_log` table.
- **Production checks**: with `NODE_ENV=production` the server refuses to start without an https `PUBLIC_ORIGIN`, a database password and `SECRETS_KEY`. The first account must come from `ADMIN_EMAIL`/`ADMIN_PASSWORD` and must choose a new password at first sign-in.

## Deploy

The app runs on its own server, in Docker, from `/opt/binmania`. `docker-compose.yml` runs four containers:

| Container | What it does |
| --- | --- |
| `caddy` | https on ports 80 and 443. Gets a free Let's Encrypt certificate for `SITE_DOMAIN`, renews it, sends http to https and `www.` to the plain domain |
| `app` | The membership app, reachable only through Caddy. Read-only file system, no Linux capabilities, health check on `/healthz` |
| `db` | MySQL 8.4, on a private Docker network the internet can't reach. Data in the `binmania_mysql` volume |
| `backup` | Dumps the database when it starts and every 24 hours into `/opt/binmania/backups`, keeping `BACKUP_KEEP_DAYS` days |

**It looks after itself.** Every container restarts if it stops, and Docker starts at boot, so the whole stack comes back after a reboot. After a reboot the app waits for MySQL to be ready. If the database stays unreachable for 2 minutes while running, the app exits so Docker restarts it. Container logs are capped at 50 MB each.

### First setup

1. Point the domain's DNS (an A record) at the server, and `www.` too (an A record, or a CNAME to the domain).
2. On the server, as root, run `deploy/setup-server.sh` once. It installs Docker and starts it at boot, allows only SSH, http and https through the firewall, and turns on automatic security updates.
3. Copy the app to `/opt/binmania` (see below), then in that folder: `cp .env.example .env`, `chmod 600 .env`, and fill it in. `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` should be long random values (`openssl rand -base64 24`); `SECRETS_KEY` comes from `openssl rand -hex 32`. Keep a copy of `SECRETS_KEY` somewhere safe: without it, the Stripe keys have to be entered again.
4. `docker compose up -d --build`. Caddy gets the certificate within a minute; `docker compose ps` shows everything healthy.

On an empty database, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` for the first start. Sign in, choose a new password, then delete `ADMIN_PASSWORD` from `.env`.

### Moving the prototype's data over

The JSON prototype at binmania.startwithdata.com keeps its data in the `binmania-loyalty_binmania_data` volume on the old server. Before the first `docker compose up` on the new server:

1. Copy it across: on the old server, `docker run --rm -v binmania-loyalty_binmania_data:/d alpine tar -C /d -cz . > binmania-data.tgz`; then extract that into `/opt/binmania/import` on the new server.
2. `docker compose up -d db`, and wait until `docker compose ps` shows it healthy.
3. `docker compose run --rm -v ./import:/old:ro app node scripts/import-json.js /old`
4. `docker compose up -d --build`, then delete the `import` folder.

Members keep their logins, cards and photos, and everyone signs in once more. Admins must choose a new password at their next sign-in. The old POS key keeps working; make a new one in Settings anyway, because the prototype kept it in plain text.

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

- **Card payments in person** (Stripe Terminal). At the counter the customer types their card on the register's screen.
- **Email receipts** (Stripe's receipts show in Billing).
- **Off-site backup copies** and uptime monitoring.
