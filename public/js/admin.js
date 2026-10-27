// Admin pages: post offers, see members, check a member code, and program settings.
import {
  $,
  api,
  confirmSheet,
  esc,
  fmtDate,
  fmtDateTime,
  icon,
  initials,
  money,
  photoToDataUrl,
  setBusy,
  showError,
  STATUS_LABEL,
  timeAgo,
  toast,
} from './lib.js';

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
        ${m.priceCents != null ? `<div><dt>Plan</dt><dd>${money(m.priceCents)} / month</dd></div>` : ''}
        ${m.currentPeriodEnd ? `<div><dt>${ends}</dt><dd>${fmtDate(m.currentPeriodEnd)}</dd></div>` : ''}
        ${m.card ? `<div><dt>Card</dt><dd>${esc(m.card)}</dd></div>` : ''}
        <div><dt>Last scanned</dt><dd>${m.lastScanAt ? esc(fmtDateTime(m.lastScanAt)) : 'Never'}</dd></div>
      </dl>
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
  const paying = all.filter((m) => m.status === 'active');
  const current = all.filter((m) => ['active', 'canceling'].includes(m.status));

  box.innerHTML = `
    <div class="stats">
      <div class="stat"><strong>${current.length}</strong><span>Active members</span></div>
      <div class="stat"><strong>${money(paying.reduce((sum, m) => sum + (m.priceCents || 0), 0))}</strong><span>Monthly revenue</span></div>
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
  list.addEventListener('click', async (e) => {
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

export function verify(ctx) {
  const main = ctx.shell();
  main.innerHTML = `
    <h1 class="page-title">Check a code</h1>
    <p class="page-sub">Try a member's card the way the register will. Each code works once.</p>
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
      const r = await api('/api/admin/verify', { method: 'POST', body: { code } });
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

// ---------- Settings ----------

export async function settings(ctx) {
  const main = ctx.shell();
  main.innerHTML = `<h1 class="page-title">Settings</h1><div id="settings"><div class="card"><p class="muted">Loading…</p></div></div>`;
  let { settings: s } = await api('/api/admin/settings');
  if (!ctx.isCurrent()) return;
  const box = $('#settings', main);
  const origin = location.origin;

  box.innerHTML = `
    <section class="card">
      <div class="toggle-row">
        <div><h2>Demo mode</h2><p>Members can enter card details and "pay" without being charged, so you can try the whole sign-up.</p></div>
        <label class="switch"><input type="checkbox" id="demo" ${s.demoMode ? 'checked' : ''} aria-label="Demo mode"><span></span></label>
      </div>
      <div class="status-line" style="margin-top:14px">
        <span class="muted small" style="font-weight:700">Stripe</span>
        <span class="chip canceled">Not connected</span>
      </div>
      <p class="muted small" id="demo-hint" style="margin-top:10px">${
        s.demoMode
          ? 'Payments are simulated. No card is charged.'
          : 'Demo mode is off and Stripe is not connected yet, so new people cannot finish signing up.'
      }</p>
    </section>

    <p class="section-label">Membership</p>
    <form class="card" id="program" novalidate>
      <div class="field"><label for="name">Program name</label><input id="name" maxlength="40" value="${esc(s.programName)}"></div>
      <div class="field"><label for="price">Monthly fee (USD)</label>
        <input id="price" type="number" inputmode="decimal" min="0.50" max="999" step="0.01" value="${(s.monthlyPriceCents / 100).toFixed(2)}">
        <span class="hint">New members pay this. Current members keep the price they joined at.</span></div>
      <div class="field"><label for="perks">Perks on the sign-up page</label>
        <textarea id="perks" rows="4">${esc(s.perks)}</textarea><span class="hint">One per line, up to 6.</span></div>
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
      <div class="field"><label>Header</label><div class="code-box" id="pos-key">X-POS-Key: ${esc(s.posApiKey)}</div></div>
      <div class="field"><label>Body</label><div class="code-box">{ "code": "BM1.100001.…" }</div></div>
      <button type="button" class="btn btn-secondary btn-sm" data-new-key>Make a new key</button>
    </section>`;

  $('#demo', box).addEventListener('change', async (e) => {
    const on = e.target.checked;
    try {
      s = (await api('/api/admin/settings', { method: 'PUT', body: { demoMode: on } })).settings;
      ctx.state.config.demoMode = s.demoMode;
      $('#demo-hint', box).textContent = s.demoMode
        ? 'Payments are simulated. No card is charged.'
        : 'Demo mode is off and Stripe is not connected yet, so new people cannot finish signing up.';
      toast(on ? 'Demo mode on' : 'Demo mode off');
    } catch (err) {
      e.target.checked = !on;
      toast(err.message, 'bad');
    }
  });

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

  $('[data-new-key]', box).addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Make a new POS key?',
      body: 'The old key stops working right away. Any register using it needs the new one.',
      confirmLabel: 'Make new key',
      danger: true,
    });
    if (!ok) return;
    s = (await api('/api/admin/settings/pos-key', { method: 'POST' })).settings;
    $('#pos-key', box).textContent = `X-POS-Key: ${s.posApiKey}`;
    toast('New key made');
  });
}
