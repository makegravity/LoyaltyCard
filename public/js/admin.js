// Admin pages: post offers, see members, check a member code (cashiers too), staff, and program settings.
import {
  $,
  api,
  confirmSheet,
  esc,
  fmtDate,
  fmtDateTime,
  icon,
  initials,
  isActiveStatus,
  money,
  photoToDataUrl,
  priceLabel,
  setBusy,
  showError,
  STATUS_LABEL,
  timeAgo,
  toast,
} from './lib.js';
import { handoffHtml, wireCopy } from './counter.js';

const PAYMENT_MODE = { off: 'Off', demo: 'Demo', sandbox: 'Sandbox (Stripe test mode)', live: 'Live (Stripe)' };

// ---------- Offers ----------

function offerRow(o) {
  return `<article class="card admin-offer" data-id="${esc(o.id)}">
    ${o.imageUrl ? `<img src="${esc(o.imageUrl)}" alt="">` : ''}
    <div class="grow">
      <div class="offer-time">${icon('clock')}<time datetime="${esc(o.createdAt)}" title="${esc(fmtDateTime(o.createdAt))}">${esc(timeAgo(o.createdAt))}</time></div>
      ${o.title ? `<h2 style="font-size:1.02rem;margin-bottom:2px">${esc(o.title)}</h2>` : ''}
      <p class="offer-text">${esc(o.body)}</p>
    </div>
    <button type="button" class="icon-btn" data-delete aria-label="Delete this offer">${icon('trash')}</button>
  </article>`;
}

export async function offers(ctx) {
  const main = ctx.shell();
  main.innerHTML = `
    <h1 class="page-title">Offers</h1>
    <p class="page-sub">Posts go to every member's Offers feed, newest first, with the time you post them.</p>
    <form class="card composer" novalidate>
      <h2>New offer</h2>
      <div class="field" style="margin-top:12px"><label for="o-title">Headline <span class="muted">(optional)</span></label>
        <input id="o-title" maxlength="80" placeholder="Green tags 50% off for members"></div>
      <div class="field"><label for="o-body">Message</label>
        <textarea id="o-body" maxlength="1000" placeholder="Show your card at checkout this Friday…"></textarea></div>
      <input type="file" id="o-image" accept="image/*" class="sr-only" tabindex="-1">
      <label for="o-image" class="image-pick" id="o-pick">${icon('image')}<span>Add a picture (optional)</span></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('megaphone')} Post to members</button>
    </form>
    <p class="section-label">Posted</p>
    <div class="feed" id="list"><div class="card"><p class="muted">Loading…</p></div></div>`;

  const form = $('form', main);
  const list = $('#list', main);
  const pick = $('#o-pick', main);
  const fileInput = $('#o-image', main);
  let image = null;
  let items = [];

  const drawList = () => {
    list.innerHTML = items.length
      ? items.map(offerRow).join('')
      : `<div class="card empty">${icon('megaphone')}<h2>Nothing posted yet</h2><p>Your first offer will show here and in members' feeds.</p></div>`;
  };
  const resetPick = () => {
    image = null;
    pick.innerHTML = `${icon('image')}<span>Add a picture (optional)</span>`;
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      image = await photoToDataUrl(file, { max: 1280, quality: 0.82 });
      pick.innerHTML = `<img src="${image}" alt=""><span>Picture added. Tap to change.</span>`;
    } catch (err) {
      showError(form, err.message);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const body = { title: $('#o-title', form).value.trim(), body: $('#o-body', form).value.trim(), image };
    if (!body.body) return showError(form, 'Write a message for the offer.');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Posting…');
    try {
      const { offer } = await api('/api/admin/offers', { method: 'POST', body });
      items.unshift(offer);
      drawList();
      form.reset();
      resetPick();
      toast('Posted to members', 'ok');
    } catch (err) {
      showError(form, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  list.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete]');
    if (!del) return;
    const id = del.closest('[data-id]').dataset.id;
    const ok = await confirmSheet({
      title: 'Delete this offer?',
      body: 'It disappears from every member\'s feed.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/offers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      items = items.filter((o) => o.id !== id);
      drawList();
      toast('Offer deleted');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  items = (await api('/api/offers')).offers;
  if (!ctx.isCurrent()) return;
  drawList();
}

// ---------- Members ----------

function memberRow(m) {
  const thumb = m.selfieUrl ? `<img src="${esc(m.selfieUrl)}" alt="">` : esc(initials(m.name));
  const ends = m.status === 'canceling' ? 'Ends' : m.status === 'canceled' ? 'Ended' : 'Next payment';
  const kind = m.billedBy === 'demo' ? '<span class="chip demo">Demo</span>' : m.billedBy === 'sandbox' ? '<span class="chip demo">Test</span>' : '';
  return `<details class="card member" data-id="${esc(m.id)}">
    <summary>
      <span class="member-thumb">${thumb}</span>
      <span class="member-main"><strong>${esc(m.name)}</strong><span>#${esc(m.memberNumber)} · joined ${fmtDate(m.joinedAt, { month: 'short', day: 'numeric' })}</span></span>
      <span class="chip ${m.status}">${STATUS_LABEL[m.status]}</span>
    </summary>
    <div class="member-detail">
      ${m.selfieUrl ? `<img class="big-photo" src="${esc(m.selfieUrl)}" alt="Photo of ${esc(m.name)}" loading="lazy">` : '<div class="notice warn" style="margin:0">' + icon('camera') + '<span>No selfie yet.</span></div>'}
      <dl class="kv" style="margin:0">
        <div><dt>Email</dt><dd>${esc(m.email)}</dd></div>
        ${m.phone ? `<div><dt>Phone</dt><dd>${esc(m.phone)}</dd></div>` : ''}
        ${m.priceCents != null ? `<div><dt>Plan</dt><dd>${esc(priceLabel({ priceCents: m.priceCents, interval: m.interval }))} ${kind}</dd></div>` : ''}
        ${m.joinedByName ? `<div><dt>Joined</dt><dd>At the counter, with ${esc(m.joinedByName)}</dd></div>` : ''}
        ${m.currentPeriodEnd ? `<div><dt>${ends}</dt><dd>${fmtDate(m.currentPeriodEnd)}</dd></div>` : ''}
        ${m.card ? `<div><dt>Card</dt><dd>${esc(m.card)}</dd></div>` : ''}
        <div><dt>Last scanned</dt><dd>${m.lastScanAt ? esc(fmtDateTime(m.lastScanAt)) + (m.lastScannedBy ? ` · ${esc(m.lastScannedBy)}` : '') : 'Never'}</dd></div>
      </dl>
      ${
        m.pending && isActiveStatus(m.status)
          ? `<div class="notice" style="margin:0">${icon('phone')}<span>Hasn't opened the card on their phone yet.</span></div>
             <button type="button" class="btn btn-secondary btn-sm" data-link>New link for their phone</button>
             <div data-handoff></div>`
          : ''
      }
      ${m.selfieUrl ? '<button type="button" class="btn btn-secondary btn-sm" data-reset-selfie>Ask for a new selfie</button>' : ''}
    </div>
  </details>`;
}

export async function members(ctx) {
  const main = ctx.shell();
  main.innerHTML = `<h1 class="page-title">Members</h1><div id="members"><div class="card"><p class="muted">Loading…</p></div></div>`;
  let { members: all } = await api('/api/admin/members');
  if (!ctx.isCurrent()) return;
  const box = $('#members', main);
  const today = new Date().toDateString();
  const paying = all.filter((m) => ['active', 'past_due'].includes(m.status));
  const current = all.filter((m) => isActiveStatus(m.status));
  // Yearly plans count as a twelfth a month.
  const perMonth = (m) => (m.priceCents || 0) / (m.interval === 'year' ? 12 : m.interval === 'week' ? 12 / 52 : m.interval === 'day' ? 12 / 365 : 1);

  box.innerHTML = `
    <div class="stats">
      <div class="stat"><strong>${current.length}</strong><span>Active members</span></div>
      <div class="stat"><strong>${money(Math.round(paying.reduce((sum, m) => sum + perMonth(m), 0)))}</strong><span>Monthly revenue</span></div>
      <div class="stat"><strong>${all.filter((m) => m.status === 'canceling').length}</strong><span>Ending this month</span></div>
      <div class="stat"><strong>${all.filter((m) => m.lastScanAt && new Date(m.lastScanAt).toDateString() === today).length}</strong><span>Scanned today</span></div>
    </div>
    <div class="field"><label class="sr-only" for="q">Search members</label>
      <input id="q" type="search" placeholder="Search name, email or member #" autocomplete="off"></div>
    <div class="member-list" id="list"></div>`;

  const list = $('#list', box);
  const draw = () => {
    const q = $('#q', box).value.trim().toLowerCase();
    const shown = q
      ? all.filter((m) => `${m.name} ${m.email} ${m.memberNumber} ${m.phone}`.toLowerCase().includes(q))
      : all;
    list.innerHTML = shown.length
      ? shown.map(memberRow).join('')
      : `<div class="card empty">${icon('users')}<h2>${all.length ? 'No matches' : 'No members yet'}</h2>
          <p>${all.length ? 'Try a different search.' : 'People who sign up show here.'}</p></div>`;
  };
  $('#q', box).addEventListener('input', draw);
  wireCopy(list);
  list.addEventListener('click', async (e) => {
    const linkBtn = e.target.closest('[data-link]');
    if (linkBtn) {
      const m = all.find((x) => x.id === linkBtn.closest('[data-id]').dataset.id);
      setBusy(linkBtn, true, 'Making link…');
      try {
        const link = await api(`/api/staff/members/${encodeURIComponent(m.id)}/link`, { method: 'POST' });
        linkBtn.closest('[data-id]').querySelector('[data-handoff]').innerHTML = handoffHtml(m, link);
      } catch (err) {
        toast(err.message, 'bad');
      }
      setBusy(linkBtn, false);
      return;
    }
    const btn = e.target.closest('[data-reset-selfie]');
    if (!btn) return;
    const row = btn.closest('[data-id]');
    const m = all.find((x) => x.id === row.dataset.id);
    const ok = await confirmSheet({
      title: `Reset ${m.name}'s photo?`,
      body: 'Their card stops working until they take a new selfie the next time they open the app.',
      confirmLabel: 'Reset photo',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/members/${encodeURIComponent(m.id)}/reset-selfie`, { method: 'POST' });
      m.selfieUrl = null;
      draw();
      toast('Photo reset');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
  draw();
}

// ---------- Check a code ----------

const REASON_TITLE = {
  expired: 'Code expired',
  already_used: 'Already scanned',
  invalid: 'Not a genuine code',
  unknown_member: 'Unknown member',
  unreadable: 'Not a member code',
  inactive: 'Membership not active',
};

function verdictHtml(r) {
  const m = r.member;
  const who = m
    ? `${m.selfieUrl ? `<img class="big-photo" src="${esc(m.selfieUrl)}" alt="Member photo">` : ''}
       <p><strong>${esc(m.name)}</strong></p>
       <p class="small">Member #${esc(m.memberNumber)} · since ${fmtDate(m.memberSince, { month: 'short', year: 'numeric' })}</p>`
    : '';
  if (r.valid) {
    return `<section class="card verdict ok">${icon('checkCircle')}<h2>Active member</h2>${who}
      <p class="muted small" style="margin-top:10px">Check the photo matches the person at the register.</p></section>`;
  }
  return `<section class="card verdict bad">${icon('xCircle')}<h2>${esc(REASON_TITLE[r.reason] || 'Not valid')}</h2>
    <p style="margin-top:6px">${esc(r.message)}</p>${who}</section>`;
}

// Cashiers and admins both use this page; cashiers see nothing else.
export function verify(ctx) {
  const cashier = ctx.state.me.role === 'cashier';
  const main = ctx.shell();
  main.innerHTML = `
    <h1 class="page-title">${cashier ? 'Scan a membership card' : 'Check a code'}</h1>
    <p class="page-sub">${
      cashier
        ? "Scan the code on the member's phone, then check their photo matches them. Each code works once."
        : "Try a member's card the way the register will. Each code works once."
    }</p>
    <section class="card">
      <div id="scan-area"></div>
      <form id="code-form" novalidate>
        <div class="field"><label for="code">Code</label>
          <input id="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="BM1.100001.…">
          <span class="hint">A USB barcode scanner works too: click in this box and scan.</span></div>
        <button class="btn btn-primary btn-block" type="submit">Check code</button>
      </form>
    </section>
    <div id="result" style="margin-top:14px"></div>`;

  const form = $('#code-form', main);
  const input = $('#code', form);
  const result = $('#result', main);
  const scanArea = $('#scan-area', main);
  let stream = null;
  let scanTimer = null;

  async function check(code) {
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Checking…');
    try {
      const r = await api('/api/staff/verify', { method: 'POST', body: { code } });
      result.innerHTML = verdictHtml(r);
      navigator.vibrate?.(r.valid ? 60 : [60, 60, 60]);
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      result.innerHTML = '';
      toast(err.message, 'bad');
    } finally {
      setBusy(btn, false);
      input.value = '';
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (code) check(code);
  });

  function stopCamera() {
    clearInterval(scanTimer);
    scanTimer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    const scanner = $('#scanner', scanArea);
    if (scanner) scanner.hidden = true;
  }

  async function startCamera() {
    const scanner = $('#scanner', scanArea);
    const video = $('video', scanArea);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      toast("Couldn't open the camera", 'bad');
      return;
    }
    if (!ctx.isCurrent()) return stopCamera();
    video.srcObject = stream;
    await video.play().catch(() => {});
    scanner.hidden = false;
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    scanTimer = setInterval(async () => {
      try {
        const [hit] = await detector.detect(video);
        if (hit && hit.rawValue) {
          stopCamera();
          check(hit.rawValue);
        }
      } catch {}
    }, 300);
  }

  // Camera scanning uses the browser's built-in QR reader (Chrome on Android, Mac and ChromeOS).
  (async () => {
    let canScan = false;
    try {
      canScan =
        window.isSecureContext &&
        'BarcodeDetector' in window &&
        !!navigator.mediaDevices?.getUserMedia &&
        (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code');
    } catch {}
    if (!ctx.isCurrent()) return;
    scanArea.innerHTML = canScan
      ? `<div class="scanner" id="scanner" hidden><video playsinline muted></video></div>
         <button class="btn btn-secondary btn-block" type="button" data-scan style="margin-bottom:16px">${icon('camera')} Scan with camera</button>`
      : `<div class="notice" style="margin-top:0">${icon('info')}<span>Camera scanning works in Chrome on Android over https. Here, type or paste the code, or use a USB scanner.</span></div>`;
    $('[data-scan]', scanArea)?.addEventListener('click', () => {
      result.innerHTML = '';
      if (stream) stopCamera();
      else startCamera();
    });
  })();

  input.focus();
  return stopCamera;
}

// ---------- Shown-once secrets ----------

// A new password or POS key, with copy buttons. Only a hash is kept, so it is never shown again.
function secretHtml(title, note, rows) {
  return `<section class="card secret" role="status" tabindex="-1">
    <h2>${icon('key')}${esc(title)}</h2>
    <p class="muted small">${esc(note)}</p>
    ${rows
      .map(
        ([label, value]) => `<div class="field"><label>${esc(label)}</label>
      <div class="secret-row"><div class="code-box">${esc(value)}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-copy="${esc(value)}" aria-label="Copy ${esc(label.toLowerCase())}">${icon('copy')}Copy</button></div></div>`
      )
      .join('')}
    <button type="button" class="btn btn-primary btn-block" data-done>Done</button>
  </section>`;
}

function showSecret(box, html) {
  box.innerHTML = html;
  const card = box.firstElementChild;
  card.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.copy);
        toast('Copied', 'ok');
      } catch {
        toast('Press and hold the text to copy it', 'bad');
      }
    }
    if (e.target.closest('[data-done]')) box.innerHTML = '';
  });
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.focus({ preventScroll: true });
}

// ---------- Staff ----------

const ROLE_LABEL = { superadmin: 'Super admin', admin: 'Admin', cashier: 'Cashier' };

function staffRow(s, me) {
  const self = s.id === me.id;
  // Only a super admin can change another super admin's login.
  const locked = s.role === 'superadmin' && me.role !== 'superadmin';
  const seen = s.lastLoginAt ? `Last signed in ${timeAgo(s.lastLoginAt).replace(/^Just/, 'just')}` : 'Not signed in yet';
  return `<article class="card staff-row" data-id="${esc(s.id)}">
    <div class="staff-top">
      <span class="member-thumb">${esc(initials(s.name))}</span>
      <span class="member-main"><strong>${esc(s.name)}${self ? ' (you)' : ''}</strong><span>${esc(s.email)}</span></span>
      <span class="chip role-${esc(s.role)}">${ROLE_LABEL[s.role]}</span>
    </div>
    <p class="muted small staff-meta">${esc(seen)}${s.mustChangePassword ? ' · has a temporary password' : ''}</p>
    ${
      self || locked
        ? ''
        : `<div class="staff-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-reset>${icon('key')}New password</button>
      <button type="button" class="btn btn-ghost btn-sm" data-remove>${icon('trash')}Remove</button></div>`
    }
  </article>`;
}

export async function staff(ctx) {
  const me = ctx.state.me;
  const main = ctx.shell();
  main.innerHTML = `
    <h1 class="page-title">Staff</h1>
    <p class="page-sub">Cashiers scan membership cards and sign up new members at the counter. Admins do everything else except payments, which only super admins manage.</p>
    <div id="secret"></div>
    <form class="card" id="add" novalidate>
      <h2>Add someone</h2>
      <div class="field" style="margin-top:12px"><label for="s-name">Name</label>
        <input id="s-name" maxlength="60" autocomplete="off" autocapitalize="words"></div>
      <div class="field"><label for="s-email">Email</label>
        <input id="s-email" type="email" maxlength="120" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <fieldset class="role-pick">
        <legend>Role</legend>
        <label class="role-option"><input type="radio" name="role" value="cashier" checked>
          <span><strong>Cashier</strong><span>Scans membership cards and signs up new members.</span></span></label>
        <label class="role-option"><input type="radio" name="role" value="admin">
          <span><strong>Admin</strong><span>Offers, members, settings and staff.</span></span></label>
        ${
          me.role === 'superadmin'
            ? `<label class="role-option"><input type="radio" name="role" value="superadmin">
          <span><strong>Super admin</strong><span>Everything, plus Stripe keys, the plan and payment mode.</span></span></label>`
            : ''
        }
      </fieldset>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${icon('userPlus')}Add and make a password</button>
    </form>
    <p class="section-label">Team</p>
    <div class="member-list" id="list"><div class="card"><p class="muted">Loading…</p></div></div>`;

  const form = $('#add', main);
  const list = $('#list', main);
  const secretBox = $('#secret', main);
  let people = [];

  const draw = () => {
    list.innerHTML = people.map((s) => staffRow(s, me)).join('');
  };
  const reveal = (person, password, isNew) => {
    const first = person.name.split(' ')[0];
    showSecret(
      secretBox,
      secretHtml(
        isNew ? `${first} is added` : `New password for ${first}`,
        `Give ${first} these details. They choose their own password when they sign in. This password isn't shown again.`,
        [
          ['Sign in at', location.origin],
          ['Email', person.email],
          ['Temporary password', password],
        ]
      )
    );
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const body = {
      name: $('#s-name', form).value.trim(),
      email: $('#s-email', form).value.trim(),
      role: form.querySelector('[name=role]:checked').value,
    };
    if (!body.name) return showError(form, 'Enter their name.');
    if (!body.email) return showError(form, 'Enter their email.');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Adding…');
    try {
      const r = await api('/api/admin/staff', { method: 'POST', body });
      people.unshift(r.staff);
      draw();
      form.reset();
      reveal(r.staff, r.password, true);
    } catch (err) {
      showError(form, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-reset], [data-remove]');
    if (!btn) return;
    const person = people.find((p) => p.id === btn.closest('[data-id]').dataset.id);
    if (btn.hasAttribute('data-reset')) {
      const ok = await confirmSheet({
        title: `Make a new password for ${person.name}?`,
        body: 'Their current password stops working and they are signed out everywhere.',
        confirmLabel: 'Make new password',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await api(`/api/admin/staff/${encodeURIComponent(person.id)}/password`, { method: 'POST' });
        Object.assign(person, r.staff);
        draw();
        reveal(person, r.password, false);
      } catch (err) {
        toast(err.message, 'bad');
      }
      return;
    }
    const ok = await confirmSheet({
      title: `Remove ${person.name}?`,
      body: "They're signed out right away and can't sign in again.",
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/staff/${encodeURIComponent(person.id)}`, { method: 'DELETE' });
      people = people.filter((p) => p.id !== person.id);
      draw();
      toast(`${person.name} removed`);
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  people = (await api('/api/admin/staff')).staff;
  if (!ctx.isCurrent()) return;
  draw();
}

// ---------- Settings ----------

function posKeyLine(s) {
  return s.posKeyHint ? `X-POS-Key: pos_…${s.posKeyHint}` : 'X-POS-Key: (no key yet)';
}

function posKeyNote(s) {
  return s.posKeyHint
    ? `Key made ${fmtDate(s.posKeyCreatedAt)}. Keys are shown once, when made. If the POS loses it, make a new one.`
    : 'Make a key when the POS is ready. Until then, the POS connection is off.';
}

export async function settings(ctx) {
  const main = ctx.shell();
  main.innerHTML = `<h1 class="page-title">Settings</h1><div id="settings"><div class="card"><p class="muted">Loading…</p></div></div>`;
  let { settings: s } = await api('/api/admin/settings');
  if (!ctx.isCurrent()) return;
  const box = $('#settings', main);
  const origin = location.origin;

  const fromStripe = s.plan.source === 'stripe';
  box.innerHTML = `
    <section class="card">
      <h2>Payments</h2>
      <dl class="kv">
        <div><dt>Mode</dt><dd>${esc(PAYMENT_MODE[s.paymentMode])}</dd></div>
        <div><dt>New members pay</dt><dd>${esc(priceLabel(s.plan))}${s.plan.open ? '' : ' · sign-up closed'}</dd></div>
      </dl>
      <p class="muted small" style="margin-top:12px">${
        ctx.state.me.role === 'superadmin'
          ? 'Change the mode, Stripe keys and plan in <a href="#/admin/payments">Payments</a>.'
          : 'Only a super admin can change the payment mode, Stripe keys and plan.'
      }</p>
    </section>

    <p class="section-label">Membership</p>
    <form class="card" id="program" novalidate>
      <div class="field"><label for="name">Program name</label><input id="name" maxlength="40" value="${esc(s.programName)}"></div>
      <div class="field"><label for="price">Monthly fee in demo mode (USD)</label>
        <input id="price" type="number" inputmode="decimal" min="0.50" max="999" step="0.01" value="${(s.monthlyPriceCents / 100).toFixed(2)}">
        <span class="hint">${
          fromStripe
            ? 'Not used now: with Stripe, the price, and the program name shown to members, come from the plan chosen in Payments.'
            : 'New members pay this. Current members keep the price they joined at.'
        }</span></div>
      <div class="field"><label for="perks">Perks on the sign-up page</label>
        <textarea id="perks" rows="4">${esc(s.perks)}</textarea><span class="hint">One per line, up to 6.${
          fromStripe ? " With Stripe, the plan's product features are shown instead, when it lists any." : ''
        }</span></div>
      <div class="field"><label for="period">Card code changes every</label>
        <select id="period">${s.qrPeriodOptions.map((p) => `<option value="${p}" ${p === s.qrPeriodSeconds ? 'selected' : ''}>${p} seconds</option>`).join('')}</select>
        <span class="hint">Shorter is harder to share; 20 seconds suits most registers.</span></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Save changes</button>
    </form>

    <p class="section-label">POS connection</p>
    <section class="card">
      <p class="muted small">When the POS is ready, it sends each scanned code here and gets back the member's name, status and photo.</p>
      <div class="field" style="margin-top:14px"><label>Endpoint</label><div class="code-box">POST ${esc(origin)}/api/pos/verify</div></div>
      <div class="field"><label>Header</label><div class="code-box" id="pos-key">${esc(posKeyLine(s))}</div>
        <span class="hint" id="pos-note">${esc(posKeyNote(s))}</span></div>
      <div class="field"><label>Body</label><div class="code-box">{ "code": "BM1.100001.…" }</div></div>
      <div id="pos-secret"></div>
      <button type="button" class="btn btn-secondary btn-sm" data-new-key>${s.posKeyHint ? 'Make a new key' : 'Make a key'}</button>
    </section>`;

  const form = $('#program', box);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Saving…');
    try {
      s = (
        await api('/api/admin/settings', {
          method: 'PUT',
          body: {
            programName: $('#name', form).value,
            monthlyPrice: $('#price', form).value,
            perks: $('#perks', form).value,
            qrPeriodSeconds: Number($('#period', form).value),
          },
        })
      ).settings;
      await ctx.refreshConfig();
      $('#perks', form).value = s.perks;
      toast('Settings saved', 'ok');
    } catch (err) {
      showError(form, err.message);
    } finally {
      setBusy(btn, false);
    }
  });

  $('[data-new-key]', box).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (s.posKeyHint) {
      const ok = await confirmSheet({
        title: 'Make a new POS key?',
        body: 'The old key stops working right away. Any register using it needs the new one.',
        confirmLabel: 'Make new key',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const r = await api('/api/admin/settings/pos-key', { method: 'POST' });
      s = r.settings;
      $('#pos-key', box).textContent = posKeyLine(s);
      $('#pos-note', box).textContent = posKeyNote(s);
      btn.textContent = 'Make a new key';
      showSecret(
        $('#pos-secret', box),
        secretHtml('Your POS key', "Copy it into the POS now. It isn't shown again.", [['X-POS-Key', r.posKey]])
      );
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}
