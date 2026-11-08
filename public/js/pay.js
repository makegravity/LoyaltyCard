// Stripe's Payment Element: the card form runs in Stripe's own frame, so card numbers never
// reach Bin Mania. Stripe.js loads only on the pages that take a card.
import { icon } from './lib.js';

let loading = null;

function loadStripeJs() {
  if (window.Stripe) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.onload = resolve;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Couldn't load the secure card form. Check your connection and try again."));
    };
    document.head.append(script);
  });
  return loading;
}

const APPEARANCE = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#0074c8',
    colorText: '#1d252d',
    colorDanger: '#e63946',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '12px',
  },
};

// Mounts the card form in `container`. `kind` is 'subscription' (take the first payment)
// or 'setup' (save a card for later payments). The intent is made only when the person
// submits: pay(getClientSecret) checks the form, asks the server for a client secret, and
// confirms it. Resolves with Stripe's PaymentIntent or SetupIntent; throws with Stripe's
// message when the card is declined.
export async function cardForm(container, { publishableKey, kind, amountCents = 0, currency = 'usd', name = '', email = '' }) {
  await loadStripeJs();
  const stripe = window.Stripe(publishableKey);
  const elements = stripe.elements({
    mode: kind,
    currency,
    ...(kind === 'subscription' ? { amount: amountCents } : {}),
    paymentMethodTypes: ['card'],
    appearance: APPEARANCE,
    fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap' }],
  });
  const element = elements.create('payment', { layout: 'tabs', defaultValues: { billingDetails: { name, email } } });
  await new Promise((resolve, reject) => {
    element.on('ready', resolve);
    element.on('loaderror', (e) => reject(new Error((e.error && e.error.message) || "Couldn't load the secure card form.")));
    container.innerHTML = '';
    element.mount(container);
  });

  return {
    async pay(getClientSecret, { returnUrl = `${location.origin}/` } = {}) {
      const checked = await elements.submit();
      if (checked.error) throw new Error(checked.error.message);
      const clientSecret = await getClientSecret();
      if (!clientSecret) return null; // nothing to pay
      const params = { elements, clientSecret, confirmParams: { return_url: returnUrl }, redirect: 'if_required' };
      const result = kind === 'setup' ? await stripe.confirmSetup(params) : await stripe.confirmPayment(params);
      if (result.error) throw new Error(result.error.message || 'The payment did not go through.');
      return result.setupIntent || result.paymentIntent;
    },
    destroy: () => element.destroy(),
  };
}

export const SANDBOX_NOTE = `<div class="notice demo">${icon('info')}<span><b>Sandbox.</b> Stripe test mode: no card is charged. Use 4242 4242 4242 4242 with any future date and any CVC.</span></div>`;
