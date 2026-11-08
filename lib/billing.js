'use strict';
// Membership status, for both kinds of subscription:
// - demo: run here. Nothing charges a card; invoices are recorded as paid.
// - stripe: run by Stripe (sandbox or live). Ours is a copy that webhooks and syncs update.
const { randomId } = require('./security');

// A Stripe membership whose renewal we haven't heard about this long after its period
// ended stops counting, in case webhooks stop arriving.
const STRIPE_GRACE_MS = 3 * 86400e3;

function addInterval(iso, interval = 'month', count = 1) {
  const d = new Date(iso);
  if (interval === 'day') d.setUTCDate(d.getUTCDate() + count);
  else if (interval === 'week') d.setUTCDate(d.getUTCDate() + 7 * count);
  else {
    const months = interval === 'year' ? 12 * count : count;
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + months);
    // Jan 31 + 1 month overflows into March; step back to the last day of February.
    if (d.getUTCDate() < day) d.setUTCDate(0);
  }
  return d.toISOString();
}

// 'demo', 'sandbox' or 'live'. Demo subscriptions made before Stripe have no mode.
function subMode(sub) {
  return sub.provider === 'stripe' ? sub.mode : 'demo';
}

// Real (live) memberships always count. Demo and sandbox ones count only while the site
// is in demo or sandbox mode, so going live ends every test membership at once.
function counts(sub, paymentMode) {
  return subMode(sub) === 'live' || paymentMode === 'demo' || paymentMode === 'sandbox';
}

// 'none' (never paid), 'active', 'canceling' (active until the period ends), 'past_due'
// (a renewal failed and Stripe is retrying; the card still works) or 'canceled'.
function status(user, paymentMode) {
  const sub = user.subscription;
  if (!sub || !counts(sub, paymentMode)) return 'none';
  if (sub.provider === 'stripe') {
    if (['incomplete', 'incomplete_expired'].includes(sub.status)) return 'none';
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) return 'canceled';
    if (Date.now() > Date.parse(sub.currentPeriodEnd) + STRIPE_GRACE_MS) return 'canceled';
    if (sub.status === 'past_due') return 'past_due';
    return sub.cancelAtPeriodEnd ? 'canceling' : 'active';
  }
  if (sub.status === 'canceled') return 'canceled';
  return sub.cancelAtPeriodEnd ? 'canceling' : 'active';
}

function isActive(user, paymentMode) {
  return ['active', 'canceling', 'past_due'].includes(status(user, paymentMode));
}

function invoice(user, amountCents, periodStart, periodEnd) {
  const card = user.paymentMethod;
  return {
    id: randomId(9),
    userId: user.id,
    amountCents,
    periodStart,
    periodEnd,
    createdAt: periodStart,
    status: 'paid',
    demo: true,
    mode: 'demo',
    card: card ? `${card.brand} •••• ${card.last4}` : null,
  };
}

// Starts a demo subscription on `user` and returns the first invoice, for the caller to save.
function start(user, priceCents, now = new Date()) {
  const startedAt = now.toISOString();
  const periodEnd = addInterval(startedAt);
  user.subscription = {
    status: 'active',
    priceCents,
    interval: 'month',
    intervalCount: 1,
    startedAt,
    currentPeriodStart: startedAt,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    demo: true,
  };
  return invoice(user, priceCents, startedAt, periodEnd);
}

// Demo subscriptions renew here; Stripe renews its own.
function isDue(user, now = Date.now()) {
  const sub = user.subscription;
  return !!sub && sub.provider !== 'stripe' && sub.status === 'active' && now >= Date.parse(sub.currentPeriodEnd);
}

// Bring a demo subscription up to date: renew each period that has passed, or end it if
// it was canceled. Changes `user.subscription` and returns the new invoices to save.
function settle(user, now = Date.now()) {
  const sub = user.subscription;
  const invoices = [];
  if (!isDue(user, now)) return invoices;
  while (now >= Date.parse(sub.currentPeriodEnd)) {
    if (sub.cancelAtPeriodEnd) {
      sub.status = 'canceled';
      sub.endedAt = sub.currentPeriodEnd;
      break;
    }
    const next = addInterval(sub.currentPeriodEnd);
    invoices.push(invoice(user, sub.priceCents, sub.currentPeriodEnd, next));
    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd = next;
  }
  return invoices;
}

module.exports = { subMode, status, isActive, isDue, start, settle };
