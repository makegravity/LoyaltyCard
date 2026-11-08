// New member at the counter (cashiers and admins): their details and photo, payment on this
// screen, then a QR code that opens their card on their own phone.
import { $, api, billedEvery, esc, icon, money, photoToDataUrl, priceLabel, setBusy, showError, toast, wait } from './lib.js';
import { cardFields, DEMO_NOTE, readCardFields, wireCardFields } from './member.js';
import { cardForm, SANDBOX_NOTE } from './pay.js';

const isActive = (m) => ['active', 'canceling', 'past_due'].includes(m.status);

// The one-time link for the member's phone, as a QR code to scan and a link to send.
export function handoffHtml(member, link) {
  const first = member.name.split(' ')[0];
  return `<section class="card handoff" role="status" tabindex="-1">
    <h2>${icon('phone')}Open ${esc(first)}'s card on their phone</h2>
    <p class="muted small">${esc(first)} scans this with their phone camera, then chooses a password. The link works once, for 24 hours.</p>
    <div class="handoff-qr">${link.svg}</div>
    <div class="secret-row"><div class="code-box">${esc(link.url)}</div>
      <button type="button" class="btn btn-secondary btn-sm" data-copy="${esc(link.url)}" aria-label="Copy link">${icon('copy')}Copy</button></div>
  </section>`;
}

export function wireCopy(root) {
  root.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy.dataset.copy);
      toast('Copied', 'ok');
    } catch {
      toast('Press and hold the link to copy it', 'bad');
    }
  });
}

export async function newMember(ctx) {
  const main = ctx.shell();
  const c = await ctx.refreshConfig();
  if (!ctx.isCurrent()) return;
  const stripe = c.paymentMode === 'sandbox' || c.paymentMode === 'live';
  const due = money(c.price.amountCents, c.price.currency);

  if (!c.signupOpen) {
    main.innerHTML = `<h1 class="page-title">New member</h1>
      <section class="card empty">${icon('lock')}<h2>Sign-up is closed</h2>
      <p>${c.paymentMode === 'off' ? 'Payments are turned off.' : 'No membership plan is set up yet.'} A super admin can set this up in Payments.</p></section>`;
    return;
  }

  main.innerHTML = `
    <h1 class="page-title">New member</h1>
    <p class="page-sub">Sign someone up at the register. They pay here, then open their card on their own phone.</p>
    <form class="card" id="who" novalidate>
      <h2>Their details</h2>
      <div class="field" style="margin-top:12px"><label for="m-name">Full name</label>
        <input id="m-name" maxlength="60" autocomplete="off" autocapitalize="words"></div>
      <div class="field"><label for="m-email">Email</label>
        <input id="m-email" type="email" maxlength="120" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false">
        <span class="hint">Their sign-in. Receipts from Stripe go here too.</span></div>
      <div class="field"><label for="m-phone">Mobile number <span class="muted">(optional)</span></label>
        <input id="m-phone" type="tel" inputmode="tel" autocomplete="off"></div>
      <input type="file" id="m-photo" accept="image/*" capture="user" class="sr-only" tabindex="-1">
      <label for="m-photo" class="image-pick" id="m-pick">${icon('camera')}<span>Take their photo for the card</span></label>
      <span class="hint">Or skip it: they'll be asked for a selfie when they open their card.</span>
    </form>
    <section class="card" id="pay" style="margin-top:14px">
      <div class="summary"><div><h2>${esc(c.programName)}</h2><p class="muted small">${esc(billedEvery(c.price))} · ${esc(priceLabel(c.price))}</p></div><strong>${due}</strong></div>
      ${stripe ? `${c.paymentMode === 'sandbox' ? SANDBOX_NOTE : ''}<div class="payment-element" id="card-element"><p class="muted small">Loading the secure card form…</p></div>` : `${DEMO_NOTE}${cardFields()}`}
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="button" data-pay ${stripe ? 'disabled' : ''}>${icon('lock')} Take ${due} and sign up</button>
      <p class="lock-line">${icon('lock')} ${stripe ? 'The customer can type their card in. It goes straight to Stripe.' : 'Demo: no card is charged'}</p>
    </section>
    <div id="done"></div>`;

  const who = $('#who', main);
  const pay = $('#pay', main);
  const btn = $('[data-pay]', pay);
  const pick = $('#m-pick', main);
  let photo = null;
  let card = null;

  $('#m-photo', main).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const taken = await photoToDataUrl(file, { max: 720, square: true });
      pick.innerHTML = `<img src="${taken}" alt=""><span>Checking the photo…</span>`;
      const { problem } = await api('/api/staff/photo-check', { method: 'POST', body: { photo: taken } });
      if (problem) {
        photo = null;
        pick.innerHTML = `${icon('camera')}<span>Take their photo for the card</span>`;
        return toast(problem, 'bad');
      }
      photo = taken;
      pick.innerHTML = `<img src="${photo}" alt=""><span>Photo added. Tap to retake.</span>`;
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  const details = () => {
    const body = {
      name: $('#m-name', who).value.trim(),
      email: $('#m-email', who).value.trim(),
      phone: $('#m-phone', who).value.trim(),
      photo,
    };
    if (body.name.length < 2) throw new Error('Enter their name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Enter a valid email address.');
    return body;
  };

  async function finish(member) {
    card?.destroy();
    card = null;
    who.remove();
    pay.remove();
    const done = $('#done', main);
    done.innerHTML = `<section class="card verdict ok">${icon('checkCircle')}<h2>${esc(member.name)} is a member</h2>
      <p class="small">Member #${esc(member.memberNumber)}</p></section>
      <div id="handoff" style="margin-top:14px"><div class="card"><p class="muted">Making their link…</p></div></div>
      <div class="actions"><button type="button" class="btn btn-secondary btn-block" data-again>${icon('userPlus')} Sign up someone else</button></div>`;
    $('[data-again]', done).addEventListener('click', () => ctx.rerender());
    wireCopy(done);
    try {
      const link = await api(`/api/staff/members/${encodeURIComponent(member.id)}/link`, { method: 'POST' });
      if (!ctx.isCurrent()) return;
      $('#handoff', done).innerHTML = handoffHtml(member, link);
    } catch (err) {
      $('#handoff', done).innerHTML = `<div class="notice warn">${icon('info')}<span>${esc(err.message)}</span></div>`;
    }
  }

  // Stripe sends the outcome by webhook as well; this asks for it straight away.
  async function confirm(member) {
    for (let i = 0; i < 4; i++) {
      member = (await api(`/api/staff/members/${encodeURIComponent(member.id)}/confirm`, { method: 'POST' })).member;
      if (isActive(member)) return member;
      await wait(1500);
    }
    throw new Error('The payment is still going through. Wait a moment, then press the button again.');
  }

  btn.addEventListener('click', async () => {
    showError(pay, '');
    let body;
    try {
      body = details();
      if (!stripe) body.card = readCardFields(pay);
    } catch (err) {
      return showError(pay, err.message);
    }
    setBusy(btn, true, 'Processing payment…');
    try {
      let member;
      if (stripe) {
        await card.pay(async () => {
          const r = await api('/api/staff/members', { method: 'POST', body });
          member = r.member;
          return isActive(member) ? null : r.clientSecret || null;
        }, { returnUrl: `${location.origin}/#/new-member` });
        if (!isActive(member)) member = await confirm(member);
      } else {
        await wait(800);
        member = (await api('/api/staff/members', { method: 'POST', body })).member;
      }
      toast('Payment approved', 'ok');
      finish(member);
    } catch (err) {
      setBusy(btn, false);
      showError(pay, err.message);
    }
  });

  if (!stripe) {
    wireCardFields(pay);
    return;
  }
  try {
    card = await cardForm($('#card-element', pay), {
      publishableKey: c.stripePublishableKey,
      kind: 'subscription',
      amountCents: c.price.amountCents,
      currency: c.price.currency,
    });
  } catch (err) {
    if (ctx.isCurrent()) showError(pay, err.message);
    return;
  }
  if (!ctx.isCurrent()) return card.destroy();
  btn.disabled = false;
  return () => card?.destroy();
}
