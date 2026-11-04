'use strict';
// Demo subscriptions, shaped like Stripe's so the swap is mostly a change of data source.
// Nothing here charges a card: invoices are recorded as paid.
const { randomId } = require('./security');

function addMonth(iso) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  // Jan 31 + 1 month overflows into March; step back to the last day of February.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString();
}

// 'none' (never paid), 'active', 'canceling' (active until the period ends) or 'canceled'.
function status(user) {
  const sub = user.subscription;
  if (!sub) return 'none';
  if (sub.status === 'canceled') return 'canceled';
  return sub.cancelAtPeriodEnd ? 'canceling' : 'active';
}

function isActive(user) {
  return ['active', 'canceling'].includes(status(user));
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
    card: card ? `${card.brand} •••• ${card.last4}` : null,
  };
}

// Starts a subscription on `user` and returns the first invoice, for the caller to save.
function start(user, priceCents, now = new Date()) {
  const startedAt = now.toISOString();
  const periodEnd = addMonth(startedAt);
  user.subscription = {
    status: 'active',
    priceCents,
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

function isDue(user, now = Date.now()) {
  const sub = user.subscription;
  return !!sub && sub.status === 'active' && now >= Date.parse(sub.currentPeriodEnd);
}

// Bring a subscription up to date: renew each period that has passed, or end it if it
// was canceled. Changes `user.subscription` and returns the new invoices to save.
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
    const next = addMonth(sub.currentPeriodEnd);
    invoices.push(invoice(user, sub.priceCents, sub.currentPeriodEnd, next));
    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd = next;
  }
  return invoices;
}

module.exports = { status, isActive, isDue, start, settle };
