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
    <p class="page-sub">Stripe keys, the plan new members join on, and whether cards are charged. Only super admins see this page. New to this? Read <a href="#/admin/help?topic=stripe">Setting up Stripe</a> in Help.</p>
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

