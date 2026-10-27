// Router and app shell (top bar + side menu). Pages live in member.js and admin.js.
import { api, esc, icon, initials, logo } from './lib.js';
import * as member from './member.js';
import * as admin from './admin.js';

const app = document.getElementById('app');
const state = { config: null, me: null, offers: [] };
const SEEN_KEY = 'bm_offers_seen';

const MEMBER_NAV = [
  { route: 'offers', label: 'Offers', icon: 'tag' },
  { route: 'card', label: 'My Membership', icon: 'card' },
  { route: 'billing', label: 'Billing', icon: 'receipt' },
];
const ADMIN_NAV = [
  { route: 'admin/offers', label: 'Offers', icon: 'megaphone' },
  { route: 'admin/members', label: 'Members', icon: 'users' },
  { route: 'admin/verify', label: 'Check a code', icon: 'scan' },
  { route: 'admin/settings', label: 'Settings', icon: 'sliders' },
];

const ROUTES = {
  '': { view: member.landing, access: 'guest' },
  login: { view: member.login, access: 'guest' },
  signup: { view: member.signup, access: 'guest' },
  join: { view: member.join, access: 'join' },
  selfie: { view: member.selfie, access: 'selfie' },
  offers: { view: member.offers, access: 'member' },
  card: { view: member.card, access: 'member' },
  billing: { view: member.billing, access: 'member' },
  'admin/offers': { view: admin.offers, access: 'admin' },
  'admin/members': { view: admin.members, access: 'admin' },
  'admin/verify': { view: admin.verify, access: 'admin' },
  'admin/settings': { view: admin.settings, access: 'admin' },
};

const isActive = (me) => me && ['active', 'canceling'].includes(me.status);

// Where a signed-in person belongs: sign-up steps first, then their card.
function homeFor(me) {
  if (!me) return '';
  if (me.role === 'admin') return 'admin/offers';
  if (me.status === 'none') return 'join';
  if (isActive(me) && !me.selfieUrl) return 'selfie';
  return 'card';
}

function guard(name) {
  const def = ROUTES[name];
  const me = state.me;
  if (!def) return homeFor(me);
  switch (def.access) {
    case 'guest':
      return me ? homeFor(me) : name;
    case 'admin':
      return me && me.role === 'admin' ? name : me ? homeFor(me) : 'login';
    case 'join':
      if (!me) return 'login';
      return me.role === 'member' && !isActive(me) ? name : homeFor(me);
    case 'selfie':
      if (!me) return 'login';
      return me.role === 'member' && isActive(me) && !me.selfieUrl ? name : homeFor(me);
    case 'member':
      if (!me) return 'login';
      if (me.role !== 'member') return homeFor(me);
      if (me.status === 'none' || (isActive(me) && !me.selfieUrl)) return homeFor(me);
      return name;
    default:
      return homeFor(me);
  }
}

function currentRoute() {
  return location.hash.replace(/^#\/?/, '').split('?')[0];
}

function go(route) {
  if (currentRoute() === route) render();
  else location.hash = '#/' + route;
}

async function refreshMe() {
  state.me = (await api('/api/me')).me;
  if (state.me && state.me.role === 'member') await refreshOffers();
  return state.me;
}

async function refreshConfig() {
  state.config = await api('/api/config');
  return state.config;
}

async function refreshOffers() {
  try {
    state.offers = (await api('/api/offers')).offers;
  } catch {
    state.offers = [];
  }
}

function seenOffersAt() {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markOffersSeen() {
  const newest = Math.max(0, ...state.offers.map((o) => Date.parse(o.createdAt)));
  try {
    localStorage.setItem(SEEN_KEY, String(newest));
  } catch {}
}

function unseenOffers() {
  const seen = seenOffersAt();
  return state.offers.filter((o) => Date.parse(o.createdAt) > seen).length;
}

async function signOut() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  state.offers = [];
  go('');
}

// Page without the menu (landing, sign-in, sign-up steps).
function bare(cls = '') {
  app.innerHTML = `<main class="wrap guest ${cls}" id="main"></main>`;
  return app.querySelector('#main');
}

// Page inside the app: top bar, side menu, and a <main> the page fills.
function shell({ wide = false } = {}) {
  const me = state.me;
  const isAdmin = me.role === 'admin';
  const nav = isAdmin ? ADMIN_NAV : MEMBER_NAV;
  const route = currentRoute();
  const unseen = isAdmin ? 0 : unseenOffers();
  const photo = me.selfieUrl ? `<img src="${esc(me.selfieUrl)}" alt="">` : esc(initials(me.name));

  app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" type="button" data-open-menu aria-label="Open menu" aria-controls="drawer" aria-expanded="false">
        ${icon('menu')}${unseen ? '<i class="dot" aria-hidden="true"></i>' : ''}
      </button>
      <a class="topbar-logo" href="#/${homeFor(me)}" aria-label="Bin Mania home">${logo()}${isAdmin ? '<span class="admin-tag">Admin</span>' : ''}</a>
      ${isAdmin ? '<span></span>' : `<a class="avatar" href="#/card" aria-label="My Membership">${photo}</a>`}
    </header>
    <div class="scrim" data-close-menu hidden></div>
    <nav class="drawer" id="drawer" aria-label="Main menu" inert>
      <div class="drawer-head">
        <button class="icon-btn light" type="button" data-close-menu aria-label="Close menu">${icon('close')}</button>
        <div class="drawer-photo">${isAdmin ? esc(initials(me.name)) : photo}</div>
        <div class="drawer-name">${esc(me.name)}</div>
        <div class="drawer-sub">${isAdmin ? esc(me.email) : `Member #${esc(me.memberNumber)}`}</div>
      </div>
      <ul class="drawer-nav">
        ${nav
          .map(
            (item) => `<li><a href="#/${item.route}" class="${item.route === route ? 'active' : ''}" ${item.route === route ? 'aria-current="page"' : ''}>
              ${icon(item.icon)}<span>${item.label}</span>${item.route === 'offers' && unseen ? `<b class="badge" aria-label="${unseen} new">${unseen}</b>` : ''}
            </a></li>`
          )
          .join('')}
      </ul>
      <div class="drawer-foot">
        <button class="drawer-signout" type="button" data-signout>${icon('logout')}Sign out</button>
        ${state.config.demoMode ? '<span class="demo-pill">Prototype · demo payments</span>' : ''}
      </div>
    </nav>
    <main class="wrap ${wide ? 'wide' : ''}" id="main"></main>`;

  const drawer = app.querySelector('#drawer');
  const scrim = app.querySelector('.scrim');
  const opener = app.querySelector('[data-open-menu]');
  const setOpen = (open) => {
    document.body.classList.toggle('menu-open', open);
    drawer.inert = !open;
    scrim.hidden = !open;
    opener.setAttribute('aria-expanded', String(open));
    if (open) (drawer.querySelector('a.active') || drawer.querySelector('a'))?.focus();
  };
  opener.addEventListener('click', () => setOpen(true));
  app.querySelectorAll('[data-close-menu]').forEach((el) => el.addEventListener('click', () => setOpen(false)));
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  drawer.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  app.querySelector('[data-signout]').addEventListener('click', signOut);
  document.body.classList.remove('menu-open');
  return app.querySelector('#main');
}

let renderSeq = 0;
let teardown = null;

async function render() {
  const name = currentRoute();
  const target = guard(name);
  if (target !== name) {
    location.replace('#/' + target); // fires hashchange, which renders the target
    return;
  }
  if (teardown) teardown();
  teardown = null;
  const seq = ++renderSeq;
  window.scrollTo(0, 0);
  const ctx = {
    state,
    go,
    bare,
    shell,
    refreshMe,
    refreshConfig,
    refreshOffers,
    seenOffersAt,
    markOffersSeen,
    signOut,
    homeFor,
    rerender: render,
    // A page that awaits checks this before touching shared state, in case the person moved on.
    isCurrent: () => seq === renderSeq,
  };
  try {
    const cleanup = await ROUTES[name].view(ctx);
    if (typeof cleanup === 'function') {
      if (seq === renderSeq) teardown = cleanup;
      else cleanup();
    }
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err.status === 401) {
      state.me = null;
      return go('login');
    }
    const main = app.querySelector('#main') || bare();
    main.innerHTML = `<div class="card empty">${icon('wifiOff')}<h2>Something went wrong</h2><p>${esc(err.message)}</p>
      <div class="actions"><button class="btn btn-primary" type="button" data-retry>Try again</button></div></div>`;
    main.querySelector('[data-retry]').addEventListener('click', render);
  }
}

async function boot() {
  try {
    await Promise.all([refreshConfig(), refreshMe()]);
  } catch (err) {
    app.innerHTML = `<main class="wrap guest"><div class="card empty">${icon('wifiOff')}<h2>Can't load Bin Mania</h2><p>${esc(err.message)}</p>
      <div class="actions"><button class="btn btn-primary" type="button" data-retry>Try again</button></div></div></main>`;
    app.querySelector('[data-retry]').addEventListener('click', () => location.reload());
    return;
  }
  window.addEventListener('hashchange', render);
  render();
}

window.addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

boot();
