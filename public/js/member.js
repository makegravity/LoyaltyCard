// Member pages: landing, sign-up steps (account, payment, selfie), My Membership, Offers, Billing.
import {
  $,
  api,
  confirmSheet,
  esc,
  fmtDate,
  fmtDateTime,
  icon,
  logo,
  money,
  PERSON_SVG,
  photoToDataUrl,
  setBusy,
  showError,
  STATUS_LABEL,
  timeAgo,
  toast,
  wait,
} from './lib.js';

const isActive = (me) => ['active', 'canceling'].includes(me.status);

function steps(n) {
  return `<div class="step-label">Step ${n} of 3</div>
    <div class="steps" aria-hidden="true"><i class="on"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i></div>`;
}

function wireSignOut(ctx, root) {
  root.querySelector('[data-signout]')?.addEventListener('click', ctx.signOut);
}

// A QR-looking pattern for the sample card on the landing page. Not a real code.
function sampleQr() {
  const n = 21;
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const finder = (x, y) => {
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const fx = x - ox;
      const fy = y - oy;
      if (fx >= -1 && fx <= 7 && fy >= -1 && fy <= 7) {
        if (fx < 0 || fy < 0 || fx > 6 || fy > 6) return false;
        return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
      }
    }
    return null;
  };
  let cells = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      if (f === null ? rnd() > 0.52 : f) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  return `<svg viewBox="0 0 21 21" shape-rendering="crispEdges" fill="#1d252d">${cells}</svg>`;
}

// ---------- landing ----------

export function landing(ctx) {
  const main = ctx.bare('landing');
  const c = ctx.state.config;
  main.innerHTML = `
    <div class="guest-top">${logo()}<a class="link" href="#/login">Sign in</a></div>
    <section class="hero">
      <p class="eyebrow">Members club</p>
      <h1>${esc(c.programName)}</h1>
      <p class="lead">Big brands. Crazy deals. Now with perks just for members.</p>
    </section>
    <div class="pass pass-preview" aria-hidden="true">
      <div class="pass-head">${logo('logo-light')}<span class="pass-badge">${esc(c.programName)}</span></div>
      <div class="pass-id">
        <div class="pass-photo">${PERSON_SVG}</div>
        <div>
          <div class="pass-name">Your name here</div>
          <div class="pass-meta">Member #100001</div>
          <span class="status-chip active"><i></i>Active</span>
        </div>
      </div>
      <div class="qr-panel"><div class="qr">${sampleQr()}</div><p class="qr-copy">Your live code changes every few seconds. Show it at checkout.</p></div>
    </div>
    <section class="card">
      <div class="price-line"><strong>${money(c.monthlyPriceCents)}</strong><span>/ month</span></div>
      <p class="muted small">Billed monthly. Cancel anytime from Billing.</p>
      <ul class="perks">${c.perks.map((p) => `<li>${icon('check')}<span>${esc(p)}</span></li>`).join('')}</ul>
      <div class="actions">
        <a class="btn btn-primary btn-block" href="#/signup">Join now</a>
        <a class="btn btn-ghost btn-block" href="#/login">I'm already a member</a>
      </div>
    </section>
    <footer class="guest-foot">
      <strong>Ohio's treasure-hunt discount store</strong>
      <span>Heath · Zanesville · Johnstown</span>
      ${c.demoMode ? '<span class="demo-pill">Prototype · payments are simulated</span>' : ''}
    </footer>`;
}

// ---------- sign in / sign up ----------

function passwordToggle(root) {
  root.querySelectorAll('[data-toggle-pw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
    });
  });
}

export function login(ctx) {
  const main = ctx.bare();
  main.innerHTML = `
    <div class="guest-top"><a href="#/" class="logo-link" aria-label="Back to start">${logo()}</a><a class="link" href="#/signup">Join</a></div>
    <h1 class="auth-title">Welcome back</h1>
    <p class="auth-sub">Sign in to see your membership card and member offers.</p>
    <form class="card" novalidate>
      <div class="field"><label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required></div>
      <div class="field"><label for="password">Password</label>
        <div class="input-wrap"><input id="password" name="password" type="password" autocomplete="current-password" required>
        <button type="button" class="input-tail" data-toggle-pw>Show</button></div></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    </form>
    <p class="switch-auth">New here? <a href="#/signup">Become a member</a></p>`;
  passwordToggle(main);
  const form = $('form', main);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return showError(form, 'Enter your email and password.');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Signing in…');
    try {
      const { me } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      ctx.state.me = me;
      if (me.role === 'member') await ctx.refreshOffers();
      ctx.go(ctx.homeFor(me));
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
}

export function signup(ctx) {
  const main = ctx.bare();
  main.innerHTML = `
    <div class="guest-top"><a href="#/" class="logo-link" aria-label="Back to start">${logo()}</a><a class="link" href="#/login">Sign in</a></div>
    ${steps(1)}
    <h1 class="auth-title">Create your account</h1>
    <p class="auth-sub">Takes a minute. Next you'll pay and add a selfie to get your card.</p>
    <form class="card" novalidate>
      <div class="field"><label for="name">Full name</label>
        <input id="name" name="name" autocomplete="name" autocapitalize="words" required></div>
      <div class="field"><label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required></div>
      <div class="field"><label for="phone">Mobile number <span class="muted">(optional)</span></label>
        <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel"></div>
      <div class="field"><label for="password">Password</label>
        <div class="input-wrap"><input id="password" name="password" type="password" autocomplete="new-password" required>
        <button type="button" class="input-tail" data-toggle-pw>Show</button></div>
        <span class="hint">At least 8 characters.</span></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Continue to payment</button>
    </form>
    <p class="switch-auth">Already a member? <a href="#/login">Sign in</a></p>`;
  passwordToggle(main);
  const form = $('form', main);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const body = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      password: form.password.value,
    };
    if (body.name.length < 2) return showError(form, 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return showError(form, 'Please enter a valid email address.');
    if (body.password.length < 8) return showError(form, 'Use at least 8 characters for your password.');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Creating account…');
    try {
      const { me } = await api('/api/auth/signup', { method: 'POST', body });
      ctx.state.me = me;
      ctx.go('join');
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
}

// ---------- card form (demo payments) ----------

function cardBrand(digits) {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^6(011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function cardFields(name = '') {
  return `
    <div class="field"><label for="cc-name">Name on card</label>
      <input id="cc-name" autocomplete="cc-name" autocapitalize="words" value="${esc(name)}"></div>
    <div class="field"><label for="cc-number">Card number</label>
      <div class="input-wrap"><input id="cc-number" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" maxlength="23">
      <span class="input-tail brand-tag" data-brand></span></div></div>
    <div class="field-row">
      <div class="field"><label for="cc-exp">Expiry</label>
        <input id="cc-exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5"></div>
      <div class="field"><label for="cc-cvc">CVC</label>
        <input id="cc-cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></div>
      <div class="field"><label for="cc-zip">ZIP</label>
        <input id="cc-zip" inputmode="numeric" autocomplete="postal-code" placeholder="43056" maxlength="5"></div>
    </div>`;
}

function wireCardFields(root) {
  const num = $('#cc-number', root);
  const exp = $('#cc-exp', root);
  const brand = $('[data-brand]', root);
  num.addEventListener('input', () => {
    const digits = num.value.replace(/\D/g, '').slice(0, 19);
    num.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    const b = cardBrand(digits);
    brand.textContent = digits.length && b !== 'Card' ? b : '';
  });
  exp.addEventListener('input', () => {
    let d = exp.value.replace(/\D/g, '').slice(0, 4);
    if (d.length === 1 && d > '1') d = '0' + d;
    exp.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  });
}

// Checks the form and returns only what the server keeps: brand, last four and expiry.
function readCardFields(root) {
  const name = $('#cc-name', root).value.trim();
  const digits = $('#cc-number', root).value.replace(/\D/g, '');
  const [mm = '', yy = ''] = $('#cc-exp', root).value.split('/');
  const cvc = $('#cc-cvc', root).value.replace(/\D/g, '');
  const zip = $('#cc-zip', root).value.replace(/\D/g, '');
  if (name.length < 2) throw new Error('Enter the name on the card.');
  if (digits.length < 13 || !luhn(digits)) throw new Error("That card number doesn't look right.");
  const expMonth = Number(mm);
  const expYear = 2000 + Number(yy);
  if (!(expMonth >= 1 && expMonth <= 12) || yy.length !== 2) throw new Error('Enter the expiry date as MM/YY.');
  const now = new Date();
  if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
    throw new Error('That card has expired.');
  }
  if (cvc.length < 3) throw new Error('Enter the 3 or 4 digit security code.');
  if (zip.length !== 5) throw new Error('Enter your 5 digit ZIP code.');
  return { name, brand: cardBrand(digits), last4: digits.slice(-4), expMonth, expYear };
}

const DEMO_NOTE = `<div class="notice demo">${icon('info')}<span><b>Demo mode.</b> No card is charged, and the full card number never leaves this phone. Try 4242 4242 4242 4242 with any future date.</span></div>`;

function nextMonth(date = new Date()) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

// ---------- step 2: payment ----------

export async function join(ctx) {
  const main = ctx.bare();
  const c = await ctx.refreshConfig();
  if (!ctx.isCurrent()) return;
  const me = ctx.state.me;
  const rejoin = me.status === 'canceled';
  const saved = me.paymentMethod;

  main.innerHTML = `
    <div class="guest-top">${logo()}<button type="button" class="btn btn-ghost btn-sm" data-signout>Sign out</button></div>
    ${rejoin ? '' : steps(2)}
    <h1 class="auth-title">${rejoin ? `Welcome back, ${esc(me.name.split(' ')[0])}` : 'Start your membership'}</h1>
    <p class="auth-sub">${rejoin ? 'Rejoin to get your card and member offers back.' : 'Your card is ready as soon as payment goes through.'}</p>
    <section class="card">
      <div class="summary"><div><h2>${esc(c.programName)}</h2><p class="muted small">Monthly membership</p></div><strong>${money(c.monthlyPriceCents)}</strong></div>
      <dl class="kv">
        <div><dt>Due today</dt><dd>${money(c.monthlyPriceCents)}</dd></div>
        <div><dt>Next payment</dt><dd>${fmtDate(nextMonth())}</dd></div>
      </dl>
    </section>
    ${
      c.demoMode
        ? `<form class="card" id="pay-form" novalidate>
            ${DEMO_NOTE}
            ${
              saved
                ? `<label class="saved-card"><input type="radio" name="which" value="saved" checked> ${esc(saved.brand)} •••• ${esc(saved.last4)}</label>
                   <label class="saved-card" style="margin:10px 0 16px;background:#fff;border-color:var(--line)"><input type="radio" name="which" value="new"> Use a different card</label>`
                : ''
            }
            <div data-new-card ${saved ? 'hidden' : ''}>${cardFields(me.name)}</div>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn btn-primary btn-block" type="submit">${icon('lock')} Pay ${money(c.monthlyPriceCents)} and join</button>
            <p class="lock-line">${icon('lock')} Card payments will be handled by Stripe</p>
          </form>`
        : `<section class="card empty" style="margin-top:14px">${icon('lock')}<h2>Online sign-up opens soon</h2>
            <p>We're getting card payments ready. Please check back soon, or ask at the register.</p></section>`
    }`;
  wireSignOut(ctx, main);
  const form = $('#pay-form', main);
  if (!form) return;
  wireCardFields(form);
  const newCard = $('[data-new-card]', form);
  const useSaved = () => saved && form.which.value === 'saved';
  form.querySelectorAll('[name=which]').forEach((r) => r.addEventListener('change', () => (newCard.hidden = useSaved())));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    let body;
    try {
      body = useSaved() ? { useSavedCard: true } : readCardFields(form);
    } catch (err) {
      return showError(form, err.message);
    }
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Processing payment…');
    try {
      await wait(1200); // stands in for the card network round trip
      const { me: updated } = await api('/api/me/subscribe', { method: 'POST', body });
      ctx.state.me = updated;
      toast('Payment approved (demo)', 'ok');
      ctx.go(ctx.homeFor(updated));
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
}

// ---------- step 3: selfie ----------

export function selfie(ctx) {
  const main = ctx.bare();
  main.innerHTML = `
    <div class="guest-top">${logo()}<button type="button" class="btn btn-ghost btn-sm" data-signout>Sign out</button></div>
    ${steps(3)}
    <h1 class="auth-title">Add your selfie</h1>
    <p class="auth-sub">Your photo goes on your membership card so our team knows it's you at checkout.</p>
    <div class="selfie-stage"><div class="selfie-frame" id="frame">${PERSON_SVG}</div></div>
    <ul class="tips" id="tips">
      <li>${icon('check')}Face the camera in good light</li>
      <li>${icon('check')}No sunglasses or hats</li>
      <li>${icon('check')}Just you in the photo</li>
    </ul>
    <p class="form-error" role="alert" hidden style="margin-top:14px"></p>
    <input type="file" id="selfie-input" accept="image/*" capture="user" class="sr-only" tabindex="-1">
    <div class="actions" id="pick">
      <label for="selfie-input" class="btn btn-primary btn-block">${icon('camera')} Take selfie</label>
    </div>
    <div class="actions" id="confirm" hidden>
      <button type="button" class="btn btn-primary btn-block" data-use>Use this photo</button>
      <label for="selfie-input" class="btn btn-secondary btn-block">Retake</label>
    </div>`;
  wireSignOut(ctx, main);

  const input = $('#selfie-input', main);
  const frame = $('#frame', main);
  const useBtn = $('[data-use]', main);
  let dataUrl = null;

  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    showError(main, '');
    try {
      dataUrl = await photoToDataUrl(file, { max: 720, square: true });
    } catch (err) {
      return showError(main, err.message);
    }
    frame.innerHTML = `<img src="${dataUrl}" alt="Your selfie">`;
    frame.classList.add('has-photo');
    $('#tips', main).hidden = true;
    $('#pick', main).hidden = true;
    $('#confirm', main).hidden = false;
  });

  useBtn.addEventListener('click', async () => {
    setBusy(useBtn, true, 'Making your card…');
    try {
      const { me } = await api('/api/me/selfie', { method: 'POST', body: { image: dataUrl } });
      ctx.state.me = me;
      await ctx.refreshOffers();
      toast('Your card is ready!', 'ok');
      ctx.go('card');
    } catch (err) {
      setBusy(useBtn, false);
      showError(main, err.message);
    }
  });
}

// ---------- My Membership ----------

const OVERLAYS = {
  hidden: `${icon('eyeOff')}<span>Code hidden</span><small>It shows again when this screen is in front.</small>`,
  offline: `${icon('wifiOff')}<span>Reconnecting…</span><small>Your code shows again once you're back online.</small>`,
  used: `${icon('checkCircle')}<span>Scanned!</span><small>Thanks for shopping at Bin Mania.</small>`,
};

export function card(ctx) {
  const me = ctx.state.me;
  const main = ctx.shell();
  const active = isActive(me);
  const photo = me.selfieUrl
    ? `<img class="pass-photo" src="${esc(me.selfieUrl)}" alt="Member photo" draggable="false">`
    : `<div class="pass-photo"></div>`;

  main.innerHTML = `
    <h1 class="page-title">My Membership</h1>
    <article class="pass" id="pass" aria-label="Membership card">
      <div class="pass-head">${logo('logo-light')}<span class="pass-badge">${esc(ctx.state.config.programName)}</span></div>
      <div class="pass-id">
        ${photo}
        <div>
          <div class="pass-name">${esc(me.name)}</div>
          <div class="pass-meta">Member #${esc(me.memberNumber)}</div>
          <div class="pass-meta">Since ${fmtDate(me.memberSince, { month: 'short', year: 'numeric' })}</div>
          <span class="status-chip ${me.status}"><i></i>${STATUS_LABEL[me.status]}</span>
        </div>
      </div>
      ${
        active
          ? `<div class="qr-panel" id="qr-panel">
              <div class="qr-box">
                <div class="qr" id="qr" role="img" aria-label="Membership code"><span class="qr-loading">Getting your code…</span></div>
                <div class="qr-overlay" id="qr-overlay" hidden></div>
              </div>
              <div class="qr-foot">
                <svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-bg" cx="18" cy="18" r="15.9155"/><circle class="ring-fg" id="ring" cx="18" cy="18" r="15.9155" stroke-dasharray="100 100" stroke-dashoffset="0"/></svg>
                <span id="countdown">Getting code…</span>
                <span class="live" title="Live clock"><i></i><span id="clock"></span></span>
              </div>
            </div>`
          : `<div class="pass-ended"><strong>Membership ended</strong><p>Rejoin to get your live card and member offers back.</p>
              <a class="btn btn-white" href="#/join">Rejoin</a></div>`
      }
    </article>
    ${
      active
        ? `<p class="pass-help">${icon('shield')}<span>Show this live screen at checkout. The code changes every <b id="period">${ctx.state.config.qrPeriodSeconds}</b> seconds and scans once, so screenshots won't work.</span></p>`
        : ''
    }
    ${
      me.status === 'canceling'
        ? `<div class="notice">${icon('info')}<span>Your membership ends ${fmtDate(me.subscription.currentPeriodEnd)}. <a href="#/billing">Keep it</a></span></div>`
        : ''
    }`;

  const passEl = $('#pass', main);
  const block = (e) => e.preventDefault();
  passEl.addEventListener('contextmenu', block);
  passEl.addEventListener('dragstart', block);
  if (!active) return;

  const panel = $('#qr-panel', main);
  const qrEl = $('#qr', main);
  const overlay = $('#qr-overlay', main);
  const countdown = $('#countdown', main);
  const ring = $('#ring', main);
  const clock = $('#clock', main);
  const periodEl = $('#period', main);

  let pass = null; // latest response from /api/me/pass
  let offset = 0; // server clock minus phone clock
  let lastFetch = 0;
  let inflight = false;
  let failures = 0;
  let lastScanSeen; // undefined until the first response
  let hidden = document.hidden;
  let overlayState = '';
  let stopped = false;
  let wakeLock = null;

  async function load() {
    inflight = true;
    lastFetch = Date.now();
    try {
      const next = await api('/api/me/pass');
      if (stopped) return;
      offset = next.serverTime - Date.now();
      if (!pass || next.window !== pass.window || !qrEl.querySelector('svg')) qrEl.innerHTML = next.svg;
      if (lastScanSeen !== undefined && next.lastScanAt && next.lastScanAt !== lastScanSeen) {
        toast('Scanned at checkout', 'ok');
        navigator.vibrate?.(60);
      }
      lastScanSeen = next.lastScanAt || null;
      periodEl.textContent = next.periodSeconds;
      pass = next;
      failures = 0;
    } catch (err) {
      if (stopped) return;
      failures++;
      if ([401, 403, 409].includes(err.status)) {
        // Membership ended or the photo was reset: reload who they are and redraw.
        stop();
        await ctx.refreshMe().catch(() => {});
        if (ctx.isCurrent()) ctx.rerender();
      }
    } finally {
      inflight = false;
    }
  }

  function setOverlay(state) {
    if (state === overlayState) return;
    overlayState = state;
    overlay.hidden = !state;
    overlay.className = `qr-overlay ${state === 'used' ? 'ok' : ''}`;
    overlay.innerHTML = OVERLAYS[state] || '';
    panel.classList.toggle('is-hidden', state === 'hidden' || state === 'offline');
  }

  function tick() {
    const now = Date.now() + offset;
    clock.textContent = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const remaining = pass ? pass.expiresAt - now : 0;
    // The server still accepts the previous code for one period, so a code a moment
    // past its time is fine; after 3 seconds without a new one, hide it.
    const stale = pass && remaining < -3000;
    const sinceFetch = Date.now() - lastFetch;
    const retryAfter = failures ? Math.min(1000 * 2 ** failures, 10000) : 0;
    const due = !pass || remaining <= 0 ? sinceFetch >= retryAfter : sinceFetch >= 3000;
    if (!inflight && !hidden && due) load();

    if (hidden) setOverlay('hidden');
    else if (stale) setOverlay('offline');
    else if (pass && pass.used) setOverlay('used');
    else setOverlay('');

    if (!pass) return;
    const secs = Math.max(0, Math.ceil(remaining / 1000));
    countdown.textContent = pass.used ? `New code in ${secs}s` : `Code changes in ${secs}s`;
    const fraction = Math.max(0, Math.min(1, remaining / (pass.periodSeconds * 1000)));
    ring.setAttribute('stroke-dashoffset', String(100 * (1 - fraction)));
  }

  async function keepAwake() {
    try {
      if (!document.hidden && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
  }

  const onVisibility = () => {
    hidden = document.hidden;
    if (!hidden) {
      lastFetch = 0;
      keepAwake();
    }
    tick();
  };
  const onBlur = () => {
    hidden = true;
    tick();
  };
  const onFocus = () => {
    hidden = document.hidden;
    lastFetch = 0;
    tick();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  const timer = setInterval(tick, 250);
  keepAwake();
  tick();

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    wakeLock?.release().catch(() => {});
  }
  return stop;
}

// ---------- Offers ----------

function stamp(iso) {
  const ageHours = (Date.now() - Date.parse(iso)) / 3600e3;
  return ageHours < 24 ? `${timeAgo(iso)} · ${fmtDateTime(iso)}` : fmtDateTime(iso);
}

function feedHtml(list, seenAt) {
  if (!list.length) {
    return `<div class="card empty">${icon('tag')}<h2>No offers yet</h2><p>New member deals drop every week. Check back soon.</p></div>`;
  }
  return list
    .map(
      (o) => `<article class="card offer">
        ${o.imageUrl ? `<img class="offer-img" src="${esc(o.imageUrl)}" alt="" loading="lazy">` : ''}
        <div class="offer-body">
          <div class="offer-time">${icon('clock')}<time datetime="${esc(o.createdAt)}">${esc(stamp(o.createdAt))}</time>
            ${Date.parse(o.createdAt) > seenAt ? '<span class="offer-new">New</span>' : ''}</div>
          ${o.title ? `<h2>${esc(o.title)}</h2>` : ''}
          <p class="offer-text">${esc(o.body)}</p>
        </div>
      </article>`
    )
    .join('');
}

export async function offers(ctx) {
  const main = ctx.shell();
  const seenAt = ctx.seenOffersAt();
  main.innerHTML = `<h1 class="page-title">Offers</h1><p class="page-sub">Members-only deals from Bin Mania.</p>
    <div class="feed" id="feed">${feedHtml(ctx.state.offers, seenAt)}</div>`;
  await ctx.refreshOffers();
  if (!ctx.isCurrent()) return;
  $('#feed', main).innerHTML = feedHtml(ctx.state.offers, seenAt);
  ctx.markOffersSeen();
  document.querySelectorAll('.topbar .dot, .drawer .badge').forEach((el) => el.remove());
}

// ---------- Billing ----------

export async function billing(ctx) {
  const main = ctx.shell();
  main.innerHTML = `<h1 class="page-title">Billing</h1><div id="billing"><div class="card"><p class="muted">Loading…</p></div></div>`;
  const [data, config] = await Promise.all([api('/api/me/billing'), ctx.refreshConfig()]);
  if (!ctx.isCurrent()) return;
  let me = (ctx.state.me = data.me);
  const invoices = data.invoices;
  const box = $('#billing', main);

  function draw() {
    const sub = me.subscription;
    const pm = me.paymentMethod;
    const status = me.status;
    box.innerHTML = `
      <section class="card">
        <div class="plan-top">
          <div><h2>${esc(config.programName)}</h2><div class="plan-price">${money(sub.priceCents)} <span>/ month</span></div></div>
          <span class="chip ${status}">${STATUS_LABEL[status]}</span>
        </div>
        <dl class="kv">
          ${status === 'active' ? `<div><dt>Next payment</dt><dd>${fmtDate(sub.currentPeriodEnd)}</dd></div>` : ''}
          ${status === 'canceling' ? `<div><dt>Membership ends</dt><dd>${fmtDate(sub.currentPeriodEnd)}</dd></div>` : ''}
          ${status === 'canceled' ? `<div><dt>Ended</dt><dd>${fmtDate(sub.endedAt)}</dd></div>` : ''}
          <div><dt>Member since</dt><dd>${fmtDate(sub.startedAt)}</dd></div>
        </dl>
        <div class="actions">
          ${status === 'active' ? '<button type="button" class="btn btn-danger-ghost btn-block" data-cancel>Cancel membership</button>' : ''}
          ${
            status === 'canceling'
              ? `<div class="notice" style="margin:0">${icon('info')}<span>You'll keep your card and member offers until ${fmtDate(sub.currentPeriodEnd)}, and won't be charged again.</span></div>
                 <button type="button" class="btn btn-primary btn-block" data-resume>Keep my membership</button>`
              : ''
          }
          ${status === 'canceled' ? `<a class="btn btn-primary btn-block" href="#/join">Rejoin for ${money(config.monthlyPriceCents)}/month</a>` : ''}
        </div>
      </section>

      <p class="section-label">Payment method</p>
      <section class="card">
        ${
          pm
            ? `<div class="pm" id="pm-row"><span class="pm-brand">${esc(pm.brand)}</span>
                <div class="pm-main"><strong>${esc(pm.brand)} •••• ${esc(pm.last4)}</strong>
                <span class="muted small">Expires ${String(pm.expMonth).padStart(2, '0')}/${String(pm.expYear).slice(-2)}</span></div>
                ${config.demoMode ? '<button type="button" class="btn btn-secondary btn-sm" data-edit>Update</button>' : ''}</div>`
            : '<p class="muted">No card on file.</p>'
        }
        <form id="card-form" novalidate hidden style="margin-top:16px">
          ${cardFields(me.name)}
          <p class="form-error" role="alert" hidden></p>
          <div class="btn-row"><button type="button" class="btn btn-secondary" data-close-edit>Cancel</button>
          <button type="submit" class="btn btn-primary">Save card</button></div>
        </form>
      </section>

      <p class="section-label">Billing history</p>
      <section class="card">
        ${
          invoices.length
            ? `<ul class="list">${invoices
                .map(
                  (i) => `<li><div><strong>${fmtDate(i.createdAt)}</strong><div class="sub">${esc(i.number)}${i.card ? ` · ${esc(i.card)}` : ''}</div></div>
                    <div style="text-align:right"><div class="amount">${money(i.amountCents)}</div><div class="sub">Paid${i.demo ? ' · demo' : ''}</div></div></li>`
                )
                .join('')}</ul>`
            : '<p class="muted">No payments yet.</p>'
        }
      </section>
      ${config.demoMode ? `<div class="notice demo">${icon('info')}<span><b>Demo mode.</b> No real charges are made.</span></div>` : ''}`;
    wire();
  }

  function wire() {
    const form = $('#card-form', box);
    wireCardFields(form);
    $('[data-edit]', box)?.addEventListener('click', () => {
      form.hidden = false;
      $('#pm-row', box).hidden = true;
      $('#cc-number', form).focus();
    });
    $('[data-close-edit]', box).addEventListener('click', () => {
      form.hidden = true;
      $('#pm-row', box).hidden = false;
      showError(form, '');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError(form, '');
      let body;
      try {
        body = readCardFields(form);
      } catch (err) {
        return showError(form, err.message);
      }
      const btn = $('[type=submit]', form);
      setBusy(btn, true, 'Saving…');
      try {
        await wait(800);
        me = ctx.state.me = (await api('/api/me/billing/payment-method', { method: 'POST', body })).me;
        toast('Card updated', 'ok');
        draw();
      } catch (err) {
        setBusy(btn, false);
        showError(form, err.message);
      }
    });
    $('[data-cancel]', box)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const ok = await confirmSheet({
        title: 'Cancel your membership?',
        body: `You'll keep your card and member offers until ${fmtDate(me.subscription.currentPeriodEnd)}. After that you won't be charged again.`,
        confirmLabel: 'Cancel membership',
        cancelLabel: 'Keep my membership',
        danger: true,
      });
      if (!ok) return;
      setBusy(btn, true, 'Canceling…');
      try {
        me = ctx.state.me = (await api('/api/me/billing/cancel', { method: 'POST' })).me;
        toast('Membership will end ' + fmtDate(me.subscription.currentPeriodEnd));
        draw();
      } catch (err) {
        setBusy(btn, false);
        toast(err.message, 'bad');
      }
    });
    $('[data-resume]', box)?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, 'Saving…');
      try {
        me = ctx.state.me = (await api('/api/me/billing/resume', { method: 'POST' })).me;
        toast("You're staying a member", 'ok');
        draw();
      } catch (err) {
        setBusy(btn, false);
        toast(err.message, 'bad');
      }
    });
  }

  draw();
}
