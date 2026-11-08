'use strict';
// Stripe, for sandbox and live mode: the super admin's keys, the plan new members join on,
// subscriptions, card changes and webhooks. Our copy of each member's subscription lives
// on their user row; Stripe is the source of truth and every sync rewrites the copy.
const Stripe = require('stripe');
const data = require('./data');
const security = require('./security');

const MODES = ['sandbox', 'live'];
const LABEL = { sandbox: 'Sandbox', live: 'Live' };
const KEY_PART = { sandbox: '_test_', live: '_live_' };
const WEBHOOK_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'price.updated',
  'product.updated',
];
// Plans are refreshed by webhooks; this catches any that were missed.
const PLAN_MAX_AGE_MS = 3600e3;
// A subscription past its period end is checked with Stripe at most this often.
const RESYNC_MS = 10 * 60e3;
const BRANDS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' };

// For tests against stripe-mock (e.g. STRIPE_API_BASE=http://localhost:12111). Ignored in production.
const API_BASE = process.env.NODE_ENV === 'production' ? null : process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;

// A message for the person, rather than a server fault.
function userError(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true });
}

const iso = (seconds) => (seconds == null ? null : new Date(seconds * 1000).toISOString());

const clients = new Map();
function client(secretKey) {
  let c = clients.get(secretKey);
  if (!c) {
    c = new Stripe(secretKey, {
      maxNetworkRetries: 2,
      timeout: 20000,
      appInfo: { name: 'Bin Mania membership' },
      ...(API_BASE ? { host: API_BASE.hostname, port: API_BASE.port, protocol: API_BASE.protocol.replace(':', '') } : {}),
    });
    clients.set(secretKey, c);
  }
  return c;
}

// The saved keys for a mode, decrypted, with a Stripe client. Null when none are saved.
async function account(mode) {
  const a = MODES.includes(mode) ? await data.getStripeAccount(mode) : null;
  if (!a) return null;
  const secretKey = security.unseal(a.secretKeyEnc);
  if (!secretKey) {
    console.error(`The ${LABEL[mode]} Stripe keys can't be read with this SECRETS_KEY. Save them again in Payments.`);
    return null;
  }
  return {
    ...a,
    secretKey,
    webhookSecret: a.webhookSecretEnc ? security.unseal(a.webhookSecretEnc) : null,
    stripe: client(secretKey),
  };
}

// What the Payments page shows about a mode's keys: never the secret ones.
function accountView(a) {
  if (!a) return null;
  return {
    publishableKey: a.publishableKey,
    secretKeyHint: a.secretKeyHint,
    webhook: a.webhookEndpointId ? 'auto' : a.webhookSecretEnc ? 'manual' : 'none',
    accountId: a.accountId,
    accountName: a.accountName,
    plan: a.plan,
    updatedAt: a.updatedAt,
    updatedByName: a.updatedByName,
  };
}

function keyProblem(mode, publishableKey, secretKey, webhookSecret) {
  const part = KEY_PART[mode];
  if (!publishableKey.startsWith(`pk${part}`)) return `${LABEL[mode]} publishable keys start with pk${part}.`;
  if (!secretKey.startsWith(`sk${part}`) && !secretKey.startsWith(`rk${part}`)) {
    return `${LABEL[mode]} secret keys start with sk${part} (or rk${part} for a restricted key).`;
  }
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) return 'Webhook signing secrets start with whsec_.';
  return null;
}

function stripeMessage(err) {
  if (err.type === 'StripeAuthenticationError') return "Stripe didn't accept that secret key.";
  if (err.type === 'StripePermissionError') return 'That key is not allowed to do this. Use the secret key, or give the restricted key more access.';
  if (err.type === 'StripeConnectionError') return "Couldn't reach Stripe. Try again in a minute.";
  return err.message;
}

// Checks the keys with Stripe, sets up the webhook (unless a signing secret is given) and
// saves them. A webhook made the last time keys were saved is removed.
async function saveKeys(mode, { publishableKey, secretKey, webhookSecret }, { origin, byName }) {
  const problem = keyProblem(mode, publishableKey, secretKey, webhookSecret);
  if (problem) throw userError(problem);
  const stripe = client(secretKey);
  let acct = null;
  try {
    acct = await stripe.accounts.retrieve();
  } catch (err) {
    // A restricted key may not be able to read the account; that's fine.
    if (err.type !== 'StripePermissionError') throw userError(stripeMessage(err));
  }
  const previous = await account(mode);
  let endpointId = null;
  let signingSecret = webhookSecret || null;
  if (!signingSecret) {
    if (!/^https:\/\//.test(origin)) {
      throw userError('Stripe can only send webhooks to an https address. Enter the signing secret from `stripe listen` instead.');
    }
    try {
      const endpoint = await stripe.webhookEndpoints.create({
        url: `${origin}/api/stripe/webhook/${mode}`,
        enabled_events: WEBHOOK_EVENTS,
        api_version: Stripe.API_VERSION,
        description: 'Bin Mania membership app',
      });
      endpointId = endpoint.id;
      signingSecret = endpoint.secret;
    } catch (err) {
      throw userError(`Couldn't set up the webhook: ${stripeMessage(err)}`);
    }
  }
  if (previous && previous.webhookEndpointId) {
    await previous.stripe.webhookEndpoints.del(previous.webhookEndpointId).catch(() => {});
  }
  const accountId = acct ? acct.id : 'unknown';
  // The plan carries over when the keys are for the same Stripe account.
  const samePlan = previous && previous.accountId === accountId;
  await data.saveStripeAccount({
    mode,
    publishableKey,
    secretKeyEnc: security.seal(secretKey),
    secretKeyHint: secretKey.slice(-4),
    webhookSecretEnc: security.seal(signingSecret),
    webhookEndpointId: endpointId,
    accountId,
    accountName: acct ? acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.email || '' : '',
    priceId: samePlan ? previous.priceId : null,
    plan: samePlan ? previous.plan : null,
    planSyncedAt: samePlan ? previous.planSyncedAt : null,
    updatedByName: byName,
  });
  return accountView(await data.getStripeAccount(mode));
}

async function removeKeys(mode) {
  const a = await account(mode);
  if (a && a.webhookEndpointId) await a.stripe.webhookEndpoints.del(a.webhookEndpointId).catch(() => {});
  await data.deleteStripeAccount(mode);
}

async function requireAccount(mode) {
  const a = await account(mode);
  if (!a) throw userError(`Add the ${LABEL[mode]} Stripe keys first.`, 409);
  return a;
}

// ---------- plans ----------

// Only plain recurring prices work as a membership: one fixed amount per period.
function usablePrice(price) {
  return (
    price.type === 'recurring' &&
    !!price.recurring &&
    price.recurring.usage_type !== 'metered' &&
    price.billing_scheme === 'per_unit' &&
    price.unit_amount != null &&
    typeof price.product === 'object' &&
    !price.product.deleted
  );
}

function planFrom(price) {
  const product = price.product;
  return {
    priceId: price.id,
    productId: product.id,
    name: product.name,
    description: product.description || '',
    features: (product.marketing_features || []).map((f) => f.name).filter(Boolean).slice(0, 6),
    amountCents: price.unit_amount,
    currency: price.currency,
    interval: price.recurring.interval,
    intervalCount: price.recurring.interval_count,
    active: !!(price.active && product.active),
  };
}

// The prices the super admin can choose from.
async function listPlans(mode) {
  const a = await requireAccount(mode);
  try {
    const prices = await a.stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product'], limit: 100 });
    return prices.data.filter((p) => usablePrice(p) && p.product.active).map(planFrom);
  } catch (err) {
    throw userError(stripeMessage(err));
  }
}

async function choosePlan(mode, priceId) {
  const a = await requireAccount(mode);
  let price;
  try {
    price = await a.stripe.prices.retrieve(String(priceId), { expand: ['product'] });
  } catch (err) {
    throw userError(err.statusCode === 404 ? 'That price is not in this Stripe account.' : stripeMessage(err));
  }
  if (!usablePrice(price) || !price.active || !price.product.active) {
    throw userError('Pick an active price that charges a fixed amount every period.');
  }
  const plan = planFrom(price);
  await data.setStripePlan(mode, price.id, plan);
  return plan;
}

// Makes a product with a recurring price in Stripe and chooses it, for a quick start.
async function createPlan(mode, { name, amountCents, interval }) {
  const a = await requireAccount(mode);
  let product;
  try {
    product = await a.stripe.products.create({
      name,
      default_price_data: { currency: 'usd', unit_amount: amountCents, recurring: { interval } },
    });
  } catch (err) {
    throw userError(stripeMessage(err));
  }
  return choosePlan(mode, typeof product.default_price === 'string' ? product.default_price : product.default_price.id);
}

const refreshing = new Set();

// Re-reads the chosen price and its product from Stripe, so name and amount changes made
// in the Stripe Dashboard show here.
async function refreshPlan(mode) {
  const a = await account(mode);
  if (!a || !a.priceId) return null;
  const price = await a.stripe.prices.retrieve(a.priceId, { expand: ['product'] });
  const plan = usablePrice(price) ? planFrom(price) : { ...a.plan, active: false };
  await data.setStripePlan(mode, a.priceId, plan);
  return plan;
}

// The saved plan for a mode, refreshed in the background when it's over an hour old.
async function currentPlan(mode) {
  const a = MODES.includes(mode) ? await data.getStripeAccount(mode) : null;
  if (!a || !a.plan) return null;
  if (Date.now() - Date.parse(a.planSyncedAt || 0) > PLAN_MAX_AGE_MS && !refreshing.has(mode)) {
    refreshing.add(mode);
    refreshPlan(mode)
      .catch((err) => console.error(`Refreshing the ${LABEL[mode]} plan failed: ${err.message}`))
      .finally(() => refreshing.delete(mode));
  }
  return a.plan;
}

async function publishableKey(mode) {
  const a = MODES.includes(mode) ? await data.getStripeAccount(mode) : null;
  return a ? a.publishableKey : null;
}

// ---------- subscriptions ----------

function cardOf(pm) {
  if (!pm || typeof pm !== 'object') return null;
  const card = pm.card;
  return {
    brand: card ? BRANDS[card.brand] || 'Card' : pm.type === 'link' ? 'Link' : 'Card',
    last4: card ? card.last4 : '',
    expMonth: card ? card.exp_month : null,
    expYear: card ? card.exp_year : null,
    name: (pm.billing_details && pm.billing_details.name) || '',
    addedAt: iso(pm.created),
    stripeId: pm.id,
  };
}

function copyOf(mode, sub) {
  const item = sub.items.data[0];
  const price = item.price;
  return {
    provider: 'stripe',
    mode,
    id: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    status: sub.status,
    priceId: price.id,
    priceCents: price.unit_amount,
    currency: price.currency,
    interval: price.recurring ? price.recurring.interval : 'month',
    intervalCount: price.recurring ? price.recurring.interval_count : 1,
    startedAt: iso(sub.start_date),
    currentPeriodStart: iso(item.current_period_start),
    currentPeriodEnd: iso(item.current_period_end),
    cancelAtPeriodEnd: !!(sub.cancel_at_period_end || sub.cancel_at),
    canceledAt: iso(sub.canceled_at),
    endedAt: iso(sub.ended_at),
    syncedAt: new Date().toISOString(),
  };
}

async function recordInvoice(mode, userId, inv, card) {
  const line = inv.lines && inv.lines.data && inv.lines.data[0];
  await data.insertInvoice({
    id: security.randomId(9),
    userId,
    amountCents: inv.amount_paid,
    periodStart: iso(line ? line.period.start : inv.period_start),
    periodEnd: iso(line ? line.period.end : inv.period_end),
    createdAt: iso((inv.status_transitions && inv.status_transitions.paid_at) || inv.created),
    status: 'paid',
    demo: false,
    mode,
    card: card && card.last4 ? `${card.brand} •••• ${card.last4}` : null,
    stripeInvoiceId: inv.id,
    receiptUrl: inv.hosted_invoice_url || null,
  });
}

// Writes Stripe's view of a subscription onto the user, and records its latest invoice
// once paid. Returns the updated user.
async function apply(user, mode, sub) {
  const fields = { subscription: copyOf(mode, sub) };
  const card = cardOf(sub.default_payment_method);
  if (card) fields.paymentMethod = card;
  await data.updateUser(user.id, fields);
  const inv = sub.latest_invoice;
  if (inv && typeof inv === 'object' && inv.status === 'paid') {
    await recordInvoice(mode, user.id, inv, fields.paymentMethod || user.paymentMethod);
  }
  return { ...user, ...fields };
}

const SYNC_EXPAND = ['default_payment_method', 'latest_invoice'];

async function customerFor(a, user) {
  const known = user.stripeCustomers && user.stripeCustomers[a.mode];
  if (known) return known;
  const customer = await a.stripe.customers.create(
    {
      email: user.email,
      name: user.name,
      ...(user.phone ? { phone: user.phone } : {}),
      metadata: { userId: user.id, memberNumber: String(user.memberNumber) },
    },
    // Two requests at once still make one customer.
    { idempotencyKey: `customer-${a.mode}-${user.id}` }
  );
  const stripeCustomers = { ...user.stripeCustomers, [a.mode]: customer.id };
  await data.updateUser(user.id, { stripeCustomers });
  user.stripeCustomers = stripeCustomers;
  return customer.id;
}

// Starts a subscription on the chosen plan that waits for its first payment. Returns the
// client secret the Payment Element confirms; none when nothing is due (a free plan).
async function startSubscription(user, mode) {
  const a = await requireAccount(mode);
  if (!a.priceId || !a.plan || !a.plan.active) throw userError('Sign-up is closed right now. Please ask at the register.', 503);
  try {
    // Retrying after a declined card reuses the same unpaid subscription.
    const prev = user.subscription;
    if (prev && prev.provider === 'stripe' && prev.mode === mode && prev.status === 'incomplete' && prev.priceId === a.priceId) {
      const sub = await a.stripe.subscriptions.retrieve(prev.id, { expand: ['latest_invoice.confirmation_secret'] });
      const secret = sub.status === 'incomplete' && sub.latest_invoice && sub.latest_invoice.confirmation_secret;
      if (secret) return { user, clientSecret: secret.client_secret, publishableKey: a.publishableKey };
    }
    const sub = await a.stripe.subscriptions.create({
      customer: await customerFor(a, user),
      items: [{ price: a.priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription', payment_method_types: ['card'] },
      metadata: { userId: user.id, memberNumber: String(user.memberNumber) },
      expand: ['latest_invoice.confirmation_secret'],
    });
    const secret = sub.latest_invoice && sub.latest_invoice.confirmation_secret;
    const fresh = await apply(user, mode, { ...sub, latest_invoice: null });
    return { user: fresh, clientSecret: secret ? secret.client_secret : null, publishableKey: a.publishableKey };
  } catch (err) {
    if (err.expose) throw err;
    console.error(`Starting a ${LABEL[mode]} subscription failed:`, err.message);
    throw userError(`Payment couldn't start: ${stripeMessage(err)}`, 502);
  }
}

// Brings the user's copy of their Stripe subscription up to date.
async function sync(user) {
  const sub = user.subscription;
  if (!sub || sub.provider !== 'stripe') return user;
  const a = await account(sub.mode);
  if (!a) return user;
  return apply(user, sub.mode, await a.stripe.subscriptions.retrieve(sub.id, { expand: SYNC_EXPAND }));
}

// True when a membership's period has ended and we haven't heard of the renewal yet.
function needsSync(user, now = Date.now()) {
  const sub = user.subscription;
  return (
    !!sub &&
    sub.provider === 'stripe' &&
    ['active', 'trialing', 'past_due'].includes(sub.status) &&
    now > Date.parse(sub.currentPeriodEnd) &&
    now - Date.parse(sub.syncedAt || 0) > RESYNC_MS
  );
}

function stripeSubOf(user) {
  const sub = user.subscription;
  if (!sub || sub.provider !== 'stripe') throw userError('This membership is not billed through Stripe.', 409);
  return sub;
}

// A SetupIntent for the Payment Element on the Billing page, to change the card.
async function cardSetup(user) {
  const sub = stripeSubOf(user);
  const a = await requireAccount(sub.mode);
  const si = await a.stripe.setupIntents.create({
    customer: sub.customerId,
    usage: 'off_session',
    allowed_payment_method_types: ['card'],
    metadata: { userId: user.id },
  });
  return { clientSecret: si.client_secret, publishableKey: a.publishableKey };
}

// Makes the card saved by a SetupIntent the one future payments use. A failed renewal
// is retried on it straight away.
async function useCard(user, setupIntentId) {
  const sub = stripeSubOf(user);
  const a = await requireAccount(sub.mode);
  const notSaved = userError("That card wasn't saved. Please try again.");
  const si = await a.stripe.setupIntents.retrieve(String(setupIntentId)).catch(() => {
    throw notSaved;
  });
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method && si.payment_method.id;
  if (si.status !== 'succeeded' || si.customer !== sub.customerId || !pm) throw notSaved;
  await a.stripe.customers.update(sub.customerId, { invoice_settings: { default_payment_method: pm } });
  const updated = await a.stripe.subscriptions.update(sub.id, { default_payment_method: pm, expand: ['latest_invoice'] });
  const inv = updated.latest_invoice;
  if (updated.status === 'past_due' && inv && typeof inv === 'object' && inv.status === 'open') {
    await a.stripe.invoices.pay(inv.id, { payment_method: pm }).catch((err) => {
      throw userError(`Your card is saved, but the payment didn't go through: ${stripeMessage(err)}`, 402);
    });
  }
  return sync(user);
}

async function setCancel(user, cancelAtPeriodEnd) {
  const sub = stripeSubOf(user);
  const a = await requireAccount(sub.mode);
  await a.stripe.subscriptions.update(sub.id, { cancel_at_period_end: cancelAtPeriodEnd });
  return sync(user);
}

// ---------- webhooks ----------

async function syncById(a, subscriptionId) {
  const sub = await a.stripe.subscriptions.retrieve(subscriptionId, { expand: SYNC_EXPAND });
  const userId = sub.metadata && sub.metadata.userId;
  const user = userId ? await data.userById(userId) : null;
  // Subscriptions made outside the app, and old unpaid attempts, are left alone.
  if (!user || !user.subscription || user.subscription.id !== sub.id) return 'ignored';
  await apply(user, a.mode, sub);
  return 'synced';
}

// Verifies and handles one webhook. Errors with `status` go back to Stripe as that status;
// anything else is a 500, and Stripe tries again later.
async function handleWebhook(mode, rawBody, signature) {
  const a = await account(mode);
  if (!a || !a.webhookSecret) throw userError('Webhooks are not set up for this mode.', 404);
  let event;
  try {
    event = a.stripe.webhooks.constructEvent(rawBody, signature || '', a.webhookSecret);
  } catch {
    throw userError('Bad signature.', 400);
  }
  if (event.livemode !== (mode === 'live')) return 'ignored';
  const obj = event.data.object;
  if (event.type.startsWith('customer.subscription.')) return syncById(a, obj.id);
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const subId = (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription) || obj.subscription;
    return subId ? syncById(a, typeof subId === 'string' ? subId : subId.id) : 'ignored';
  }
  if (event.type === 'price.updated' || event.type === 'product.updated') {
    const ours = a.plan && (obj.id === a.priceId || obj.id === a.plan.productId);
    if (!ours) return 'ignored';
    await refreshPlan(mode);
    return 'plan refreshed';
  }
  return 'ignored';
}

module.exports = {
  MODES,
  LABEL,
  WEBHOOK_EVENTS,
  account,
  accountView,
  saveKeys,
  removeKeys,
  listPlans,
  choosePlan,
  createPlan,
  refreshPlan,
  currentPlan,
  publishableKey,
  startSubscription,
  sync,
  needsSync,
  cardSetup,
  useCard,
  setCancel,
  handleWebhook,
};
