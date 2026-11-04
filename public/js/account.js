// Account pages for everyone signed in: change password. Staff given a temporary
// password by an admin land here first and can't use anything else until they change it.
import { $, api, esc, logo, passwordToggle, setBusy, showError, toast } from './lib.js';

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
