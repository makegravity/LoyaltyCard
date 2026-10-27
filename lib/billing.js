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

function addInvoice(db, user, amountCents, periodStart, periodEnd) {
  const card = user.paymentMethod;
  db.invoices.push({
    id: randomId(9),
    number: `BM-${String(db.invoices.length + 1).padStart(5, '0')}`,
    userId: user.id,
    amountCents,
    periodStart,
    periodEnd,
    createdAt: periodStart,
    status: 'paid',
    demo: true,
    card: card ? `${card.brand} •••• ${card.last4}` : null,
  });
}

function start(db, user, priceCents, now = new Date()) {
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
  addInvoice(db, user, priceCents, startedAt, periodEnd);
}

// Bring a subscription up to date: renew each period that has passed, or end it if it
// was canceled. Returns true when something changed and needs saving.
function settle(db, user, now = Date.now()) {
  const sub = user.subscription;
  if (!sub || sub.status !== 'active') return false;
  let changed = false;
  while (now >= Date.parse(sub.currentPeriodEnd)) {
    changed = true;
    if (sub.cancelAtPeriodEnd) {
      sub.status = 'canceled';
      sub.endedAt = sub.currentPeriodEnd;
      break;
    }
    const next = addMonth(sub.currentPeriodEnd);
    addInvoice(db, user, sub.priceCents, sub.currentPeriodEnd, next);
    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd = next;
  }
  return changed;
}

module.exports = { status, isActive, start, settle };
