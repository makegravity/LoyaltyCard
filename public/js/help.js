// Help (super admins only): how the site works, who can do what, setting up Stripe, everyday
// tasks and what to do when something goes wrong. One page; the contents buttons jump to a
// topic, and #/admin/help?topic=stripe opens at one.
import { $, esc, icon } from './lib.js';

const TOPICS = [
  ['overview', 'How the site works'],
  ['roles', 'Who can do what'],
  ['stripe', 'Setting up Stripe'],
  ['tasks', 'Everyday tasks'],
  ['trouble', 'If something goes wrong'],
];

// A table that stacks into labelled rows on a phone.
const table = (head, rows) => `<div class="table-wrap"><table class="guide-table">
  <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(head[i])}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

const card = (title, body) => `<section class="card guide"><h3>${esc(title)}</h3>${body}</section>`;
const steps = (items) => `<ol>${items.map((s) => `<li>${s}</li>`).join('')}</ol>`;

// ---------- Who can do what ----------

const ROLES = ['Member', 'Cashier', 'Admin', 'Super admin'];
// [what, member, cashier, admin, super admin]
const PERMISSIONS = [
  ['Join, pay, add a selfie; see their card, offers and billing', 1, 0, 0, 0],
  ['Change their own password', 1, 1, 1, 1],
  ['Scan and check membership cards', 0, 1, 1, 1],
  ['Sign up new members at the counter (details, photo, payment, phone link)', 0, 1, 1, 1],
  ['Post and delete offers', 0, 0, 1, 1],
  ["See all members; ask for a new selfie; make a new phone link", 0, 0, 1, 1],
  ['Add cashiers and admins, reset their passwords, remove them', 0, 0, 1, 1],
  ['Settings: program name, demo fee, perks, code rotation, POS key', 0, 0, 1, 1],
  ['Add, reset or remove super admins', 0, 0, 0, 1],
  ['Payments: Stripe keys, the plan, the payment mode', 0, 0, 0, 1],
  ['Read this Help', 0, 0, 0, 1],
];

function matrix() {
  const yes = `<span class="yes" aria-label="Yes">${icon('check')}</span>`;
  const no = '<span class="no" aria-label="No">–</span>';
  return `<div class="table-wrap"><table class="matrix">
    <thead><tr><th>Can…</th>${ROLES.map((r) => `<th>${esc(r)}</th>`).join('')}</tr></thead>
    <tbody>${PERMISSIONS.map(([what, ...cells]) => `<tr><td>${esc(what)}</td>${cells.map((c) => `<td>${c ? yes : no}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- Stripe ----------

const KEY_PERMISSIONS = [
  ['Customers', 'Write', 'Makes a Stripe customer for each member and sets the card future payments use'],
  ['Subscriptions', 'Write', 'Starts memberships, cancels and resumes them, and reads their status'],
  ['Invoices', 'Write', 'Records each payment in Billing history; retries a failed renewal on a new card'],
  ['Payment Intents', 'Read', "Hands the first payment to Stripe's card form"],
  ['Setup Intents', 'Write', 'Saves a new card when a member changes theirs'],
  ['Payment Methods', 'Read', 'Shows the card brand and last four digits'],
  ['Products and Prices', 'Write', 'Lists prices to choose a plan, keeps it in sync, and makes one with "Create and use it" (Read is enough without that button)'],
  ['Webhook Endpoints', 'Write', 'Sets up the webhook when you save keys and removes it when you remove them'],
];

// ---------- If something goes wrong ----------

const TROUBLE = [
  ['"Already scanned" at the register', "Each code works once. Ask the member for the new code on their screen; it changes every few seconds."],
  ['"Code expired"', 'Their screen showed an old code (offline, or a screenshot). Ask them to open their live card.'],
  ['"Membership not active"', 'Not paid, ended, or a demo or sandbox membership after going live. They can rejoin by signing in on their phone.'],
  ['"Payment due" on a member', "A renewal failed. The card keeps working while Stripe retries; when they update their card in Billing, it's charged straight away."],
  ['A photo is refused', 'The check found no face, a face too small, or a second person. Good light, face the camera, just them in the photo.'],
  ['A member forgot their password', "Password reset by email isn't built yet. For now, a member who can't sign in can't be helped from the app."],
  ["A counter member's phone link expired", 'Members → find them → New link for their phone. This works until they have opened their card once.'],
  ['"Confirm your password to change payments"', 'The 10-minute unlock on Payments ran out. Unlock again.'],
  ['"…publishable keys start with pk_test_" (or similar)', 'The key is for the other mode, or the two keys were swapped. Copy them again from the right place in Stripe.'],
  ["\"Stripe didn't accept that secret key\"", 'The key was mistyped, rolled or deleted. Copy a current one from Stripe.'],
  ['"That key is not allowed to do this"', 'A restricted key is missing a permission from the Stripe section. Add it in Stripe, then save the keys again.'],
  ["\"Couldn't set up the webhook\"", "The key can't write Webhook Endpoints. Add that permission, or paste a signing secret from a webhook you made in Stripe."],
  ['"Switch payments away from … before removing its keys"', 'Pick another payment mode first, then remove the keys.'],
];

export function docs(ctx) {
  const main = ctx.shell();
  const origin = location.origin;
  const period = ctx.state.config.qrPeriodSeconds;
  main.innerHTML = `
    <h1 class="page-title">Help</h1>
    <p class="page-sub">How ${esc(location.host)} works, who can do what, and how to set it up. Only super admins see this page.</p>
    <nav class="help-nav card" aria-label="Help topics">
      ${TOPICS.map(([key, label]) => `<button type="button" class="btn btn-secondary btn-sm" data-jump="${key}">${esc(label)}</button>`).join('')}
    </nav>

    <section class="help-topic" id="help-overview">
      <h2 class="help-head">How the site works</h2>
      ${card(
        'Members',
        `<p>People join online at <a href="${esc(origin)}">${esc(location.host)}</a> (create an account, pay, add a selfie), or a cashier signs them up at the register. Then they have:</p>
        <ul>
          <li><b>My Membership</b>: their card, with their photo, member number, status and a live QR code. The code changes every ${esc(period)} seconds and works once, so screenshots and forwarded codes don't work.</li>
          <li><b>Offers</b>: the deals admins post, newest first.</li>
          <li><b>Billing</b>: their plan, next payment, card (they can change it), receipts, and Cancel or Keep my membership.</li>
        </ul>
        <p class="muted small">Members stay signed in for 30 days. Staff sessions last 12 hours, because registers are shared.</p>`
      )}
      ${card(
        'At the register',
        `<p>Cashiers open <b>Scan cards</b> (admins: <b>Check a code</b>) and scan the code on the member's phone: with the camera (Chrome on Android), a USB barcode scanner, or by typing it.</p>
        <ul>
          <li><b>Green, "Active member"</b>: check the photo matches the person.</li>
          <li><b>Red</b>: the reason shows (already scanned, expired, not genuine, not active). See <i>If something goes wrong</i>.</li>
        </ul>
        <p>Register software can check codes by itself with the <b>POS key</b> (Settings → POS connection); cashiers using Scan cards don't need it.</p>`
      )}
      ${card(
        'Payments',
        `<p>The payment mode, set on <a href="#/admin/payments">Payments</a>, decides whether cards are charged and which memberships count.</p>
        ${table(
          ['Mode', 'New sign-ups', 'Memberships that count'],
          [
            ['Off', 'Closed', 'Live ones'],
            ['Demo', 'Made-up cards, nothing charged', 'All'],
            ['Sandbox', 'Stripe test cards, nothing charged', 'All'],
            ['Live', 'Real cards, through Stripe', 'Live ones'],
          ]
        )}
        <ul>
          <li>Stripe runs the billing: it charges each period and renews. The app learns of each payment through a webhook.</li>
          <li>New members join on the plan chosen in Payments; current members keep the price they joined at.</li>
          <li>Going live ends demo and sandbox memberships. Live memberships keep working in every mode.</li>
        </ul>`
      )}
      ${card(
        'Behind the scenes',
        `<ul>
          <li>The app and its MySQL database run on their own server, over https. Everything restarts by itself after a crash or reboot.</li>
          <li>The database is backed up every day on the server, and the backups are kept for 14 days.</li>
          <li>Card photos are checked for one clear face before they're saved.</li>
          <li>Stripe keys are stored encrypted. Card numbers never reach the site: they go straight to Stripe.</li>
          <li>The audit log records sign-ins, staff, settings and payment changes, sign-ups and every code check: who, what, when and from where.</li>
        </ul>`
      )}
    </section>

    <section class="help-topic" id="help-roles">
      <h2 class="help-head">Who can do what</h2>
      ${card(
        'The four kinds of login',
        `${table(
          ['Role', 'Gets in by', 'Lands on'],
          [
            ['Member', 'Joining online, or a cashier signs them up', 'My Membership'],
            ['Cashier', 'An admin adds them in Staff', 'Scan cards'],
            ['Admin', 'An admin adds them in Staff', 'Offers'],
            ['Super admin', 'Another super admin adds them in Staff', 'Offers (plus Payments and Help in the menu)'],
          ]
        )}`
      )}
      ${card('Permissions', matrix())}
      ${card(
        'Staff logins',
        `<ul>
          <li>New staff get a temporary password, shown once, to pass on. At first sign-in they must choose their own: 8 characters or more, like every password.</li>
          <li>Only a super admin can add, reset or remove a super admin. Nobody can remove themselves, so there is always a super admin.</li>
          <li>Removing someone, or giving them a new password, signs them out everywhere at once.</li>
        </ul>`
      )}
    </section>

    <section class="help-topic" id="help-stripe">
      <h2 class="help-head">Setting up Stripe</h2>
      <p class="help-lead">Set up a Stripe sandbox first, so nothing is charged, then repeat with live keys when you're ready to take real money.</p>
      ${card(
        '1. Unlock Payments',
        `<p>Every change on <a href="#/admin/payments">Payments</a> needs your password again; one confirmation holds for 10 minutes. Enter it under <b>Confirm it's you</b> and press <b>Unlock</b>.</p>`
      )}
      ${card(
        '2. Get your Stripe keys',
        `<p>In the Stripe Dashboard, open <b>Developers → API keys</b> (<a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener">sandbox</a>, <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">live</a>). Each mode needs two keys:</p>
        ${table(
          ['Key', 'Sandbox', 'Live', 'What it does'],
          [
            ['Publishable key', 'pk_test_…', 'pk_live_…', "Loads Stripe's card form in members' browsers. Safe to show."],
            ['Secret key', 'sk_test_…', 'sk_live_…', "The server's access to your Stripe account. Keep it secret."],
            ['Restricted key (instead of the secret key)', 'rk_test_…', 'rk_live_…', 'Same job, limited to the permissions in step 3.'],
          ]
        )}
        <p>The standard secret key is fine for a sandbox. For live, a restricted key is safer: if it ever leaks, it can only do what this app needs.</p>`
      )}
      ${card(
        '3. Permissions for a restricted key',
        `<p>Make it under <b>Developers → API keys → Create restricted key</b>, one for sandbox and one for live. Give it these and leave everything else at None:</p>
        ${table(['Stripe permission', 'Access', 'What the app uses it for'], KEY_PERMISSIONS)}
        <p class="muted small">Account read access is optional: without it Payments shows the account id instead of its name.</p>`
      )}
      ${card(
        '4. Save the keys',
        steps([
          'On Payments, open the <b>Sandbox</b> tab (or <b>Live (production)</b>) and paste the publishable and secret keys.',
          `Leave <b>Webhook signing secret</b> empty: the app sets up its own webhook in Stripe at <code>${esc(origin)}/api/stripe/webhook/sandbox</code> (or <code>/live</code>). Stripe uses it to report renewals, failed payments, cancellations and plan changes.`,
          'Press <b>Check and save keys</b>. The app checks them with Stripe first; the tab then shows <b>Connected</b>.',
        ]) +
          `<p>The secret key is stored encrypted and never shown again. To change keys, use <b>Replace keys</b>; the old webhook is removed for you.</p>
          <p class="muted small">On a test copy without https, Stripe can't reach the app: run <code>stripe listen --forward-to localhost:4090/api/stripe/webhook/sandbox</code> and paste the whsec_ secret it prints.</p>`
      )}
      ${card(
        '5. Choose the plan new members join on',
        `<p>Press <b>Choose a plan</b>, pick one of the account's recurring prices and press <b>Use this plan</b>. No plan in Stripe yet? Use <b>Or create a plan in Stripe</b>.</p>
        ${table(
          ['In the app', 'Comes from Stripe'],
          [
            ['Program name on the landing page and cards', 'Product name'],
            ['Price and "/ month" (or year) on the landing page, sign-up and Billing', 'Price amount, currency and interval'],
            ['Perks on the landing page', "Product's marketing features (if none, the perks from Settings)"],
          ]
        )}
        <p>Changes in the Stripe Dashboard arrive within seconds by webhook, or press <b>Refresh from Stripe</b>. If the price is archived in Stripe, sign-up closes until you choose another.</p>`
      )}
      ${card(
        '6. Test in sandbox, then go live',
        steps([
          'Under <b>Payment mode</b>, pick <b>Sandbox</b> and save.',
          'Join as a new member, or use <b>New member</b> at the counter, with the test card 4242 4242 4242 4242, any future date and any CVC.',
          'Add the live keys and choose the live plan the same way, on the <b>Live (production)</b> tab.',
          'Pick <b>Live</b> and confirm. Real cards are charged from then on. Try it once: join with your own card under another email address, then cancel in Billing (and refund the payment in Stripe if you like).',
        ])
      )}
    </section>

    <section class="help-topic" id="help-tasks">
      <h2 class="help-head">Everyday tasks</h2>
      ${card(
        'Add a staff member',
        steps([
          'Menu → <b>Staff</b>.',
          'Enter their name and email, pick Cashier, Admin or Super admin, and press <b>Add and make a password</b>.',
          'Give them the sign-in address, their email and the temporary password shown. It is not shown again.',
        ])
      )}
      ${card(
        'Someone forgot their staff password',
        steps(['Menu → <b>Staff</b> → their row → <b>New password</b>.', 'Pass on the new temporary password. They choose their own at sign-in.'])
      )}
      ${card(
        'Sign up a customer at the counter',
        steps([
          'Menu → <b>New member</b>.',
          'Enter their name and email (and mobile, if they like), then <b>Take their photo</b>. The photo is checked for a face straight away.',
          'Hand them the screen to type their card into the card form, then press <b>Take … and sign up</b>.',
          'They scan the QR code with their phone camera and choose a password; their card opens on their phone.',
        ])
      )}
      ${card(
        'Post an offer',
        steps(['Menu → <b>Offers</b>.', "Add a headline (optional), the message and a picture (optional), then <b>Post to members</b>. It appears at the top of every member's Offers."])
      )}
      ${card(
        "Ask a member for a new photo",
        steps(['Menu → <b>Members</b> → open the member → <b>Ask for a new selfie</b>.', "Their card stops until they take a new one the next time they open the app."])
      )}
      ${card(
        'Change the price',
        `<ul>
          <li><b>With Stripe</b> (sandbox or live): add a new price to the product in Stripe (Product catalog), then Payments → <b>Change plan</b> and pick it. Or edit the product's name and features in Stripe; they update here by themselves.</li>
          <li><b>In demo mode</b>: Settings → <b>Monthly fee in demo mode</b>.</li>
          <li>Current members keep the price they joined at.</li>
        </ul>`
      )}
      ${card(
        'Connect a register (POS)',
        steps([
          'Menu → <b>Settings</b> → POS connection → <b>Make a key</b>.',
          'Give the register software the endpoint and the key shown. The key is not shown again.',
          'Making a new key stops the old one at once.',
        ])
      )}
    </section>

    <section class="help-topic" id="help-trouble">
      <h2 class="help-head">If something goes wrong</h2>
      ${card('What you see, and what to do', table(['What you see', 'What to do'], TROUBLE))}
      ${card(
        'Keeping it safe',
        `<ul>
          <li>Only paste Stripe keys into Payments. If a secret key may have leaked, roll it in Stripe, then save the new one with <b>Replace keys</b>.</li>
          <li>Give each person their own login, so the audit log shows who did what. Remove people who leave.</li>
          <li>Sign out of shared devices; staff sessions end on their own after 12 hours.</li>
        </ul>`
      )}
    </section>`;

  main.addEventListener('click', (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) $(`#help-${jump.dataset.jump}`, main).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const topic = new URLSearchParams(location.hash.split('?')[1] || '').get('topic') || (location.hash.includes('payments/guide') ? 'stripe' : '');
  if (topic && $(`#help-${topic}`, main)) requestAnimationFrame(() => $(`#help-${topic}`, main).scrollIntoView({ block: 'start' }));
}
