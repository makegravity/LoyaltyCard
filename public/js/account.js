// Account pages: change password, forgot password and its emailed link, and the link a counter sign-up opens on
// their phone. Staff given a temporary password by an admin land here first and can't use anything else until they
// change it.
import { $, api, esc, icon, logo, passwordToggle, setBusy, showError, toast } from './lib.js';

export function password(ctx) {
  const me = ctx.state.me;
  const forced = me.mustChangePassword;
  const main = forced ? ctx.bare() : ctx.shell();
  main.innerHTML = `
    ${forced ? `<div class="guest-top">${logo()}<button type="button" class="btn btn-ghost btn-sm" data-signout>Sign out</button></div>` : ''}
    <h1 class="${forced ? 'auth-title' : 'page-title'}">${forced ? 'Choose your own password' : 'Change password'}</h1>
    <p class="${forced ? 'auth-sub' : 'page-sub'}">${
      forced
        ? `Hi ${esc(me.name.split(' ')[0])}. You signed in with a temporary password. Pick one only you know before you start.`
        : "You'll stay signed in here. Any other phone or computer signed in as you is signed out."
    }</p>
    <form class="card" novalidate>
      <input type="email" name="username" value="${esc(me.email)}" autocomplete="username" hidden>
      <div class="field"><label for="current">${forced ? 'Temporary password' : 'Current password'}</label>
        <div class="input-wrap"><input id="current" name="current" type="password" autocomplete="current-password" required>
        <button type="button" class="input-tail" data-toggle-pw>Show</button></div></div>
      <div class="field"><label for="next">New password</label>
        <div class="input-wrap"><input id="next" name="next" type="password" autocomplete="new-password" minlength="${me.passwordMinLength}" required>
        <button type="button" class="input-tail" data-toggle-pw>Show</button></div>
        <span class="hint">At least ${me.passwordMinLength} characters.</span></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${forced ? 'Save and continue' : 'Change password'}</button>
    </form>`;
  passwordToggle(main);
  main.querySelector('[data-signout]')?.addEventListener('click', ctx.signOut);

  const form = $('form', main);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const currentPassword = form.current.value;
    const newPassword = form.next.value;
    if (!currentPassword) return showError(form, `Enter your ${forced ? 'temporary' : 'current'} password.`);
    if (newPassword.length < me.passwordMinLength) {
      return showError(form, `Use at least ${me.passwordMinLength} characters for your new password.`);
    }
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Saving…');
    try {
      const res = await api('/api/me/password', { method: 'POST', body: { currentPassword, newPassword } });
      ctx.state.me = res.me;
      toast('Password changed', 'ok');
      ctx.go(ctx.homeFor(res.me));
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
  form.current.focus({ preventScroll: true });
}

// Forgot password (#/forgot), for members and staff: a link to choose a new one, by email.
export function forgot(ctx) {
  const main = ctx.bare();
  const top = `<div class="guest-top"><a href="#/" class="logo-link" aria-label="Back to start">${logo()}</a><a class="link" href="#/login">Sign in</a></div>`;
  main.innerHTML = `
    ${top}
    <h1 class="auth-title">Forgot your password?</h1>
    <p class="auth-sub">Enter the email you sign in with, and we'll send you a link to choose a new password.</p>
    <form class="card" novalidate>
      <div class="field"><label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"
          value="${esc(ctx.state.forgotEmail || '')}" required></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Email me a link</button>
    </form>
    <p class="switch-auth">Remembered it? <a href="#/login">Sign in</a></p>`;
  const form = $('form', main);

  const sent = (email) => {
    main.innerHTML = `
      ${top}
      <section class="card empty">${icon('mail')}<h2>Check your email</h2>
        <p>If <b>${esc(email)}</b> has an account, a link to choose a new password is on its way. It works once, for the next hour.</p></section>
      <p class="switch-auth">Nothing after a few minutes? Check your spam or junk folder, or <a href="#/forgot" data-again>send it again</a>.</p>`;
    $('[data-again]', main).addEventListener('click', (e) => {
      e.preventDefault();
      forgot(ctx);
    });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const email = form.email.value.trim();
    if (!email) return showError(form, 'Enter your email.');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Sending…');
    try {
      await api('/api/auth/forgot', { method: 'POST', body: { email } });
      ctx.state.forgotEmail = email;
      if (ctx.isCurrent()) sent(email);
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
  form.email.focus({ preventScroll: true });
}

// The link from a password reset email (#/reset?t=…): they choose a new password and are signed in here, and
// signed out everywhere else.
export async function reset(ctx) {
  const main = ctx.bare();
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('t') || '';
  main.innerHTML = `<div class="guest-top">${logo()}</div><div class="card"><p class="muted">Checking your link…</p></div>`;
  let who;
  try {
    who = await api('/api/auth/reset/check', { method: 'POST', body: { token } });
  } catch (err) {
    if (!ctx.isCurrent()) return;
    main.innerHTML = `<div class="guest-top">${logo()}<a class="link" href="#/login">Sign in</a></div>
      <section class="card empty">${icon('info')}<h2>This link doesn't work</h2><p>${esc(err.message)}</p>
        <div class="actions"><a class="btn btn-primary" href="#/forgot">Email me a new link</a></div></section>`;
    return;
  }
  if (!ctx.isCurrent()) return;
  const min = who.passwordMinLength;
  main.innerHTML = `
    <div class="guest-top">${logo()}</div>
    <h1 class="auth-title">Choose a new password</h1>
    <p class="auth-sub">For ${esc(who.email)}. You'll be signed in here, and signed out on any other phone or computer.</p>
    <form class="card" novalidate>
      <input type="email" name="username" value="${esc(who.email)}" autocomplete="username" hidden>
      <div class="field"><label for="next">New password</label>
        <div class="input-wrap"><input id="next" name="next" type="password" autocomplete="new-password" minlength="${min}" required>
        <button type="button" class="input-tail" data-toggle-pw>Show</button></div>
        <span class="hint">At least ${min} characters.</span></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Save and sign in</button>
    </form>`;
  passwordToggle(main);
  const form = $('form', main);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const password = form.next.value;
    if (password.length < min) return showError(form, `Use at least ${min} characters for your password.`);
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Saving…');
    try {
      const { me } = await api('/api/auth/reset', { method: 'POST', body: { token, password } });
      ctx.state.me = me;
      if (me.role === 'member') await ctx.refreshOffers();
      toast('Password changed', 'ok');
      location.replace('#/' + ctx.homeFor(me)); // drops the used link from history
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
  form.next.focus({ preventScroll: true });
}

// The link from a counter sign-up (#/claim?t=…): the member chooses a password and their
// card opens on this phone.
export async function claim(ctx) {
  const main = ctx.bare();
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('t') || '';
  main.innerHTML = `<div class="guest-top">${logo()}</div><div class="card"><p class="muted">Checking your link…</p></div>`;
  let who;
  try {
    who = await api('/api/auth/claim/check', { method: 'POST', body: { token } });
  } catch (err) {
    if (!ctx.isCurrent()) return;
    main.innerHTML = `<div class="guest-top">${logo()}<a class="link" href="#/login">Sign in</a></div>
      <section class="card empty">${icon('info')}<h2>This link doesn't work</h2><p>${esc(err.message)}</p></section>`;
    return;
  }
  if (!ctx.isCurrent()) return;
  main.innerHTML = `
    <div class="guest-top">${logo()}</div>
    <h1 class="auth-title">Welcome, ${esc(who.name.split(' ')[0])}!</h1>
    <p class="auth-sub">Choose a password to open your membership card. You'll sign in with ${esc(who.email)} next time.</p>
    <form class="card" novalidate>
      <input type="email" name="username" value="${esc(who.email)}" autocomplete="username" hidden>
      <div class="field"><label for="next">Password</label>
        <div class="input-wrap"><input id="next" name="next" type="password" autocomplete="new-password" minlength="8" required>
        <button type="button" class="input-tail" data-toggle-pw>Show</button></div>
        <span class="hint">At least 8 characters.</span></div>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Open my card</button>
    </form>`;
  passwordToggle(main);
  const form = $('form', main);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(form, '');
    const password = form.next.value;
    if (password.length < 8) return showError(form, 'Use at least 8 characters for your password.');
    const btn = $('[type=submit]', form);
    setBusy(btn, true, 'Opening your card…');
    try {
      const { me } = await api('/api/auth/claim', { method: 'POST', body: { token, password } });
      ctx.state.me = me;
      await ctx.refreshOffers();
      toast('Welcome to Bin Mania!', 'ok');
      location.replace('#/' + ctx.homeFor(me)); // drops the used link from history
    } catch (err) {
      setBusy(btn, false);
      showError(form, err.message);
    }
  });
  form.next.focus({ preventScroll: true });
}
