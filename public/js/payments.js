// Payments (super admins only): Stripe keys for sandbox and live, the plan new members join
// on, and the payment mode. Changes need the super admin's password, which holds 10 minutes.
import { $, api, confirmSheet, esc, fmtDate, fmtDateTime, icon, priceLabel, setBusy, showError, toast } from './lib.js';

const LABEL = { off: 'Off', demo: 'Demo', sandbox: 'Sandbox', live: 'Live' };
const MODE_HELP = {
  off: 'No new sign-ups. Members who paid for real keep their cards.',
  demo: 'Made-up card details, nothing charged. For trying the app.',
  sandbox: 'Stripe test mode: test cards only, nothing charged.',
  live: 'Real cards, charged through Stripe.',
};
const DASHBOARD = { sandbox: 'https://dashboard.stripe.com/test/apikeys', live: 'https://dashboard.stripe.com/apikeys' };
const PRODUCTS = { sandbox: 'https://dashboard.stripe.com/test/products', live: 'https://dashboard.stripe.com/products' };

function planHtml(plan) {
  if (!plan) return '<p class="muted small">No plan chosen yet. New members can\'t join in this mode until you pick one.</p>';
  return `<div class="plan-box">
    <div><strong>${esc(plan.name)}</strong><span class="muted small">${esc(priceLabel(plan))}</span></div>
    ${plan.active ? '<span class="chip active">In use</span>' : '<span class="chip none">Archived</span>'}
  </div>
  ${plan.active ? '' : `<div class="notice warn">${icon('info')}<span>This price or product is archived in Stripe, so nobody can join on it. Pick another plan.</span></div>`}
  ${plan.features.length ? `<p class="muted small" style="margin-top:8px">Perks from Stripe: ${plan.features.map(esc).join(' · ')}</p>` : ''}`;
}

function keysForm(mode, v, replacing) {
  const part = mode === 'sandbox' ? 'test' : 'live';
  return `<form class="keys-form" data-keys="${mode}" novalidate ${replacing ? 'hidden' : ''}>
    <p class="muted small">In Stripe: Developers → API keys (<a href="${DASHBOARD[mode]}" target="_blank" rel="noopener">open</a>).
      ${mode === 'sandbox' ? 'Use the keys of a sandbox, so nothing is charged.' : 'These charge real cards.'}</p>
    <div class="field"><label for="${mode}-pk">Publishable key</label>
      <input id="${mode}-pk" autocomplete="off" spellcheck="false" placeholder="pk_${part}_…"></div>
    <div class="field"><label for="${mode}-sk">Secret key</label>
      <input id="${mode}-sk" type="password" autocomplete="off" spellcheck="false" placeholder="sk_${part}_…">
      <span class="hint">Kept encrypted. Nobody can see it here again, including you.</span></div>
    <div class="field"><label for="${mode}-wh">Webhook signing secret <span class="muted">(${v.httpsSite ? 'optional' : 'needed here'})</span></label>
      <input id="${mode}-wh" type="password" autocomplete="off" spellcheck="false" placeholder="whsec_…">
      <span class="hint">${
        v.httpsSite
          ? 'Leave empty and the app sets up its webhook in Stripe by itself.'
          : `Stripe can't reach this address. Run <code>stripe listen --forward-to ${esc(v.webhookUrls[mode].replace(/^https?:\/\/[^/]+/, 'localhost:4090'))}</code> and paste the secret it prints.`
      }</span></div>
    <p class="form-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block" type="submit">${icon('key')}Check and save keys</button>
  </form>`;
}

const TAB_LABEL = { sandbox: 'Sandbox', live: 'Live (production)' };

// Sandbox and live each get a tab: its name, whether it's the mode in use, and how far its
// setup has got.
function tabsHtml(v, active) {
  return `<div class="tabs" role="tablist" aria-label="Stripe accounts">${['sandbox', 'live']
    .map((m) => {
      const a = v.accounts[m];
      const state = !a ? ['No keys', 'none'] : a.plan && a.plan.active ? ['Ready', 'active'] : ['No plan yet', 'canceling'];
      return `<button type="button" role="tab" class="tab" id="tab-${m}" data-tab="${m}" aria-controls="panel-${m}"
          aria-selected="${m === active}" tabindex="${m === active ? 0 : -1}">
        <span>${TAB_LABEL[m]}</span><small class="tab-state ${state[1]}">${v.mode === m ? 'In use · ' : ''}${state[0]}</small></button>`;
    })
    .join('')}</div>`;
}

function accountHtml(mode, v, shown) {
  const a = v.accounts[mode];
  const panel = `class="card tab-panel" id="panel-${mode}" role="tabpanel" aria-labelledby="tab-${mode}" data-acct="${mode}" ${shown ? '' : 'hidden'}`;
  if (!a) return `<section ${panel}>${keysForm(mode, v, false)}</section>`;
  return `<section ${panel}>
    <div class="status-line"><span class="chip active">Connected</span><span class="muted small">${esc(a.accountName || a.accountId)}</span></div>
    <dl class="kv">
      <div><dt>Publishable key</dt><dd>${esc(a.publishableKey.slice(0, 8))}…${esc(a.publishableKey.slice(-6))}</dd></div>
      <div><dt>Secret key</dt><dd>•••• ${esc(a.secretKeyHint)}</dd></div>
      <div><dt>Webhook</dt><dd>${a.webhook === 'auto' ? 'Set up in Stripe' : a.webhook === 'manual' ? 'Signing secret entered' : 'Not set up'}</dd></div>
      <div><dt>Saved</dt><dd>${fmtDate(a.updatedAt)}${a.updatedByName ? ` · ${esc(a.updatedByName)}` : ''}</dd></div>
    </dl>
    <h3 class="sub-head">Plan new members join on</h3>
    ${planHtml(a.plan)}
    <div class="btn-row wrap" style="margin-top:12px">
      <button type="button" class="btn btn-secondary btn-sm" data-pick="${mode}">${a.plan ? 'Change plan' : 'Choose a plan'}</button>
      ${a.plan ? `<button type="button" class="btn btn-ghost btn-sm" data-refresh="${mode}">${icon('refresh')}Refresh from Stripe</button>` : ''}
    </div>
    <div data-plans="${mode}"></div>
    <div class="btn-row wrap" style="margin-top:18px">
      <button type="button" class="btn btn-ghost btn-sm" data-replace="${mode}">${icon('key')}Replace keys</button>
      <button type="button" class="btn btn-ghost btn-sm" data-remove="${mode}">${icon('trash')}Remove keys</button>
    </div>
    ${keysForm(mode, v, true)}
  </section>`;
}

function modeOptions(v) {
  return ['off', 'demo', 'sandbox', 'live']
    .map((m) => {
      const a = v.accounts[m];
      const missing = (m === 'sandbox' || m === 'live') && !(a && a.plan && a.plan.active) ? (a ? 'Choose a plan first.' : 'Add keys first.') : '';
      return `<label class="role-option ${missing ? 'is-off' : ''}"><input type="radio" name="mode" value="${m}" ${v.mode === m ? 'checked' : ''} ${missing ? 'disabled' : ''}>
        <span><strong>${LABEL[m]}${v.mode === m ? ' (now)' : ''}</strong><span>${MODE_HELP[m]}${missing ? ` ${missing}` : ''}</span></span></label>`;
    })
    .join('');
}

export async function payments(ctx) {
  const main = ctx.shell();
  main.innerHTML = `<h1 class="page-title">Payments</h1>
    <p class="page-sub">Stripe keys, the plan new members join on, and whether cards are charged. Only super admins see this page. New to this? Read the <a href="#/admin/payments/guide">setup guide</a>.</p>
    <div id="payments"><div class="card"><p class="muted">Loading…</p></div></div>`;
  let v = await api('/api/admin/payments');
  if (!ctx.isCurrent()) return;
  const box = $('#payments', main);
  let lockTimer = null;
  // The open tab; it opens on live once live is the mode in use.
  let tab = v.mode === 'live' ? 'live' : 'sandbox';

  function selectTab(mode, focus = false) {
    tab = mode;
    box.querySelectorAll('[role=tab]').forEach((t) => {
      const on = t.dataset.tab === mode;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    box.querySelectorAll('[role=tabpanel]').forEach((p) => (p.hidden = p.dataset.acct !== mode));
  }

  function draw() {
    const unlocked = v.unlockedUntil && Date.parse(v.unlockedUntil) > Date.now();
    box.innerHTML = `
      <section class="card ${unlocked ? 'unlocked' : ''}" id="lock">
        ${
          unlocked
            ? `<div class="status-line"><span class="chip active">${icon('lock')}Unlocked</span><span class="muted small">You can make changes until ${esc(fmtDateTime(v.unlockedUntil))}.</span></div>`
            : `<form id="unlock" novalidate>
                <h2>${icon('lock')}Confirm it's you</h2>
                <p class="muted small">Enter your password to change anything on this page. It stays unlocked for 10 minutes.</p>
                <div class="field" style="margin-top:12px"><label for="pw">Your password</label>
                  <input id="pw" type="password" autocomplete="current-password"></div>
                <p class="form-error" role="alert" hidden></p>
                <button class="btn btn-primary btn-block" type="submit">Unlock</button>
              </form>`
        }
      </section>
      <p class="section-label">Payment mode</p>
      <form class="card" id="mode-form" novalidate>
        <fieldset class="role-pick" style="margin-bottom:12px"><legend class="sr-only">Payment mode</legend>${modeOptions(v)}</fieldset>
        <p class="muted small">Going live ends demo and sandbox memberships (${v.counts.testMembers} now). Live memberships keep working in every mode.</p>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Save payment mode</button>
      </form>
      <p class="section-label">Stripe keys and plan</p>
      ${tabsHtml(v, tab)}
      ${accountHtml('sandbox', v, tab === 'sandbox')}
      ${accountHtml('live', v, tab === 'live')}`;
    clearTimeout(lockTimer);
    if (unlocked) lockTimer = setTimeout(() => ctx.isCurrent() && draw(), Date.parse(v.unlockedUntil) - Date.now() + 500);
  }

  // Runs a change; asks for the password again when the unlock has run out.
  async function change(fn, errorBox) {
    try {
      v = await fn();
      draw();
      return true;
    } catch (err) {
      if (err.data && err.data.reason === 'elevate') {
        v.unlockedUntil = null;
        draw();
        toast('Confirm your password first', 'bad');
        $('#pw', box)?.focus();
      } else if (errorBox) showError(errorBox, err.message);
      else toast(err.message, 'bad');
      return false;
    }
  }

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = $('[type=submit]', form);
    showError(form, '');

    if (form.id === 'unlock') {
      setBusy(btn, true, 'Checking…');
      try {
        v = await api('/api/admin/payments/unlock', { method: 'POST', body: { password: $('#pw', form).value } });
        draw();
        toast('Unlocked for 10 minutes', 'ok');
      } catch (err) {
        setBusy(btn, false);
        showError(form, err.message);
      }
      return;
    }

    if (form.id === 'mode-form') {
      const mode = form.querySelector('[name=mode]:checked')?.value;
      if (!mode || mode === v.mode) return toast(`Payments are already ${LABEL[v.mode]}`);
      const sheets = {
        live: {
          title: 'Go live?',
          body: `Real cards are charged from now on. ${v.counts.testMembers} demo and sandbox membership(s) stop working; those members can rejoin with a real card.`,
          confirmLabel: 'Go live',
        },
        off: { title: 'Turn payments off?', body: 'Nobody can sign up until you turn them back on. Live members keep their cards.', confirmLabel: 'Turn off' },
      };
      const sheet =
        sheets[mode] ||
        (v.mode === 'live'
          ? {
              title: `Leave live mode for ${LABEL[mode]}?`,
              body: `New sign-ups won't be charged, and their memberships count as real until you go live again. The ${v.counts.liveMembers} live member(s) keep their cards.`,
              confirmLabel: `Switch to ${LABEL[mode]}`,
            }
          : null);
      if (sheet && !(await confirmSheet({ ...sheet, danger: true }))) return;
      setBusy(btn, true, 'Saving…');
      if (await change(() => api('/api/admin/payments/mode', { method: 'PUT', body: { mode } }), form)) {
        await ctx.refreshConfig();
        toast(`Payments: ${LABEL[mode]}`, 'ok');
      } else setBusy(btn, false);
      return;
    }

    if (form.dataset.keys) {
      const mode = form.dataset.keys;
      const body = {
        publishableKey: $(`#${mode}-pk`, form).value.trim(),
        secretKey: $(`#${mode}-sk`, form).value.trim(),
        webhookSecret: $(`#${mode}-wh`, form).value.trim(),
      };
      if (!body.publishableKey || !body.secretKey) return showError(form, 'Enter the publishable key and the secret key.');
      setBusy(btn, true, 'Checking with Stripe…');
      if (await change(() => api(`/api/admin/payments/${mode}/keys`, { method: 'PUT', body }), form)) toast(`${LABEL[mode]} keys saved`, 'ok');
      else setBusy(btn, false);
      return;
    }

    if (form.dataset.newPlan) {
      const mode = form.dataset.newPlan;
      const body = { name: $('[name=name]', form).value.trim(), amount: $('[name=amount]', form).value, interval: $('[name=interval]', form).value };
      setBusy(btn, true, 'Creating in Stripe…');
      if (await change(() => api(`/api/admin/payments/${mode}/plans`, { method: 'POST', body }), form)) toast('Plan created and chosen', 'ok');
      else setBusy(btn, false);
      return;
    }

    if (form.dataset.choosePlan) {
      const mode = form.dataset.choosePlan;
      const priceId = form.querySelector('[name=price]:checked')?.value;
      if (!priceId) return showError(form, 'Pick a plan.');
      setBusy(btn, true, 'Saving…');
      if (await change(() => api(`/api/admin/payments/${mode}/plan`, { method: 'PUT', body: { priceId } }), form)) {
        await ctx.refreshConfig();
        toast('Plan saved', 'ok');
      } else setBusy(btn, false);
    }
  });

  // Arrow keys move between the tabs, as in any tab list.
  box.addEventListener('keydown', (e) => {
    const t = e.target.closest('[role=tab]');
    if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    selectTab(t.dataset.tab === 'sandbox' ? 'live' : 'sandbox', true);
  });

  box.addEventListener('click', async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) return selectTab(tabBtn.dataset.tab);
    const el = e.target.closest('[data-pick], [data-refresh], [data-replace], [data-remove]');
    if (!el) return;
    if (el.dataset.replace) {
      const form = $(`[data-keys="${el.dataset.replace}"]`, box);
      form.hidden = !form.hidden;
      if (!form.hidden) $('input', form).focus();
      return;
    }
    if (el.dataset.refresh) {
      setBusy(el, true, 'Refreshing…');
      if (await change(() => api(`/api/admin/payments/${el.dataset.refresh}/refresh`, { method: 'POST' }))) {
        await ctx.refreshConfig();
        toast('Plan refreshed from Stripe', 'ok');
      } else setBusy(el, false);
      return;
    }
    if (el.dataset.remove) {
      const mode = el.dataset.remove;
      const ok = await confirmSheet({
        title: `Remove the ${LABEL[mode].toLowerCase()} keys?`,
        body: "The app stops talking to this Stripe account, and its webhook is removed. Members' subscriptions in Stripe are not touched.",
        confirmLabel: 'Remove keys',
        danger: true,
      });
      if (ok && (await change(() => api(`/api/admin/payments/${mode}/remove`, { method: 'POST' })))) toast('Keys removed');
      return;
    }
    // Choose a plan: the account's recurring prices, plus a quick way to make one.
    const mode = el.dataset.pick;
    const holder = $(`[data-plans="${mode}"]`, box);
    setBusy(el, true, 'Loading plans…');
    let plans;
    try {
      plans = (await api(`/api/admin/payments/${mode}/plans`)).plans;
    } catch (err) {
      setBusy(el, false);
      return toast(err.message, 'bad');
    }
    setBusy(el, false);
    const current = v.accounts[mode].plan;
    holder.innerHTML = `
      ${
        plans.length
          ? `<form data-choose-plan="${mode}" novalidate class="plan-pick">
              <fieldset class="role-pick"><legend>Prices in this Stripe account</legend>
              ${plans
                .map(
                  (p) => `<label class="role-option"><input type="radio" name="price" value="${esc(p.priceId)}" ${current && current.priceId === p.priceId ? 'checked' : ''}>
                    <span><strong>${esc(p.name)} · ${esc(priceLabel(p))}</strong><span>${esc(p.description || p.priceId)}</span></span></label>`
                )
                .join('')}</fieldset>
              <p class="form-error" role="alert" hidden></p>
              <button class="btn btn-primary btn-block" type="submit">Use this plan</button>
            </form>`
          : `<p class="muted small" style="margin-top:12px">No recurring prices in this Stripe account yet. Make one below, or in Stripe's <a href="${PRODUCTS[mode]}" target="_blank" rel="noopener">Product catalog</a>.</p>`
      }
      <form data-new-plan="${mode}" novalidate class="plan-new">
        <h3 class="sub-head">Or create a plan in Stripe</h3>
        <div class="field"><label>Name</label><input name="name" maxlength="60" value="${esc(v.defaults.name)}"></div>
        <div class="field-row two">
          <div class="field"><label>Price (USD)</label><input name="amount" type="number" inputmode="decimal" min="0.50" max="999" step="0.01" value="${(v.defaults.amountCents / 100).toFixed(2)}"></div>
          <div class="field"><label>Billed</label><select name="interval"><option value="month">Monthly</option><option value="year">Yearly</option></select></div>
        </div>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-secondary btn-block" type="submit">Create and use it</button>
      </form>`;
    holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  draw();
  return () => clearTimeout(lockTimer);
}

// ---------- Setup guide ----------

// The same steps as the "Setting up Stripe" doc, here so every super admin can read them.
const PERMISSIONS = [
  ['Customers', 'Write', 'Makes a Stripe customer for each member and sets the card future payments use'],
  ['Subscriptions', 'Write', 'Starts memberships, cancels and resumes them, and reads their status'],
  ['Invoices', 'Write', 'Records each payment in Billing history; retries a failed renewal on a new card'],
  ['Payment Intents', 'Read', "Hands the first payment to Stripe's card form"],
  ['Setup Intents', 'Write', 'Saves a new card when a member changes theirs'],
  ['Payment Methods', 'Read', 'Shows the card brand and last four digits'],
  ['Products and Prices', 'Write', 'Lists prices to choose a plan, keeps it in sync, and makes one with "Create and use it" (Read is enough without that button)'],
  ['Webhook Endpoints', 'Write', 'Sets up the webhook when you save keys and removes it when you remove them'],
];

const TROUBLE = [
  ['…publishable keys start with pk_test_ (or similar)', 'The key is for the other mode, or the two keys were swapped. Copy them again from the right place.'],
  ["Stripe didn't accept that secret key", 'The key was mistyped, rolled or deleted. Copy a current one from Stripe.'],
  ['That key is not allowed to do this', 'A restricted key is missing a permission from the table above. Add it in Stripe, then save the keys again.'],
  ["Couldn't set up the webhook", "The key can't write Webhook Endpoints. Add that permission, or paste a signing secret from a webhook you made in Stripe."],
  ['Confirm your password to change payments', 'The 10-minute unlock ran out. Unlock again.'],
  ['Switch payments away from … before removing its keys', 'Pick another payment mode first, then remove the keys.'],
];

const table = (head, rows) => `<div class="table-wrap"><table class="guide-table">
  <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(head[i])}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export function guide(ctx) {
  const main = ctx.shell();
  const origin = location.origin;
  main.innerHTML = `
    <p class="back-link"><a href="#/admin/payments">← Payments</a></p>
    <h1 class="page-title">Setting up Stripe</h1>
    <p class="page-sub">For super admins. Set up a Stripe sandbox first, so nothing is charged, then repeat with live keys when you're ready to take real money.</p>

    <section class="card guide">
      <h2>1. Unlock Payments</h2>
      <p>Every change on <a href="#/admin/payments">Payments</a> needs your password again; one confirmation holds for 10 minutes. Enter it under <b>Confirm it's you</b> and press <b>Unlock</b>.</p>
      <p class="muted small">Only super admins see Payments. A super admin can add more super admins under Staff; admins can't.</p>
    </section>

    <section class="card guide">
      <h2>2. Get your Stripe keys</h2>
      <p>In the Stripe Dashboard, open <b>Developers → API keys</b> (<a href="https://dashboard.stripe.com/test/apikeys" target="_blank" rel="noopener">sandbox</a>, <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">live</a>). Each mode needs two keys:</p>
      ${table(
        ['Key', 'Sandbox', 'Live', 'What it does'],
        [
          ['Publishable key', 'pk_test_…', 'pk_live_…', "Loads Stripe's card form in members' browsers. Safe to show."],
          ['Secret key', 'sk_test_…', 'sk_live_…', "The server's access to your Stripe account. Keep it secret."],
          ['Restricted key (instead of the secret key)', 'rk_test_…', 'rk_live_…', 'Same job, limited to the permissions below.'],
        ]
      )}
      <p>The standard secret key is fine for a sandbox. For live, a restricted key is safer: if it ever leaks, it can only do what this app needs.</p>
    </section>

    <section class="card guide">
      <h2>3. Permissions for a restricted key</h2>
      <p>Make it under <b>Developers → API keys → Create restricted key</b>, one for sandbox and one for live. Give it these and leave everything else at None:</p>
      ${table(['Stripe permission', 'Access', 'What the app uses it for'], PERMISSIONS)}
      <p class="muted small">Account read access is optional: without it Payments shows the account id instead of its name.</p>
    </section>

    <section class="card guide">
      <h2>4. Save the keys</h2>
      <ol>
        <li>On Payments, open the <b>Sandbox</b> tab (or <b>Live (production)</b>) and paste the publishable and secret keys.</li>
        <li>Leave <b>Webhook signing secret</b> empty: the app sets up its own webhook in Stripe at <code>${esc(origin)}/api/stripe/webhook/sandbox</code> (or <code>/live</code>). Stripe uses it to report renewals, failed payments, cancellations and plan changes.</li>
        <li>Press <b>Check and save keys</b>. The app checks them with Stripe first; the section then shows <b>Connected</b>.</li>
      </ol>
      <p>The secret key is stored encrypted and never shown again. To change keys, use <b>Replace keys</b>; the old webhook is removed for you.</p>
      <p class="muted small">On a test copy without https, Stripe can't reach the app: run <code>stripe listen --forward-to localhost:4090/api/stripe/webhook/sandbox</code> and paste the whsec_ secret it prints.</p>
    </section>

    <section class="card guide">
      <h2>5. Choose the plan new members join on</h2>
      <p>Press <b>Choose a plan</b>, pick one of the account's recurring prices and press <b>Use this plan</b>. No plan in Stripe yet? Use <b>Or create a plan in Stripe</b>. Current members keep the price they joined at.</p>
      ${table(
        ['In the app', 'Comes from Stripe'],
        [
          ['Program name on the landing page and cards', 'Product name'],
          ['Price and "/ month" (or year) on the landing page, sign-up and Billing', 'Price amount, currency and interval'],
          ['Perks on the landing page', "Product's marketing features (if none, the perks from Settings)"],
        ]
      )}
      <p>Changes in the Stripe Dashboard arrive within seconds by webhook, or press <b>Refresh from Stripe</b>. If the price is archived in Stripe, sign-up closes until you choose another.</p>
    </section>

    <section class="card guide">
      <h2>6. Test in sandbox, then go live</h2>
      <ol>
        <li>Under <b>Payment mode</b>, pick <b>Sandbox</b> and save.</li>
        <li>Sign up as a new member, or use <b>New member</b> at the counter, with the test card 4242 4242 4242 4242, any future date and any CVC.</li>
        <li>Add the live keys and choose the live plan the same way.</li>
        <li>Pick <b>Live</b> and confirm. Real cards are charged from then on.</li>
      </ol>
      <p>Going live ends every demo and sandbox membership (the confirmation shows how many); those members can rejoin with a real card. Live memberships keep working in every mode.</p>
    </section>

    <section class="card guide">
      <h2>If something goes wrong</h2>
      ${table(['Message on Payments', 'What to do'], TROUBLE)}
      <ul>
        <li>Only paste keys into Payments. Backups hold only the encrypted copy.</li>
        <li>If a secret key may have leaked, roll it in Stripe, then save the new one with <b>Replace keys</b>.</li>
        <li>Every key, plan and mode change is recorded in the audit log with who made it.</li>
      </ul>
    </section>`;
}
