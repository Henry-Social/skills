# Checkout modes, webhooks, and environments

Distilled from the Checkout, Universal Cart, Webhooks, and FAQ pages at
<https://docs.henrylabs.ai>.

## Hosted checkout

The `checkoutUrl` returned by `cart.create` is a complete hosted checkout
page — Henry collects shipping, payment, and tax; the integrating app has
zero PCI burden. Append `?theme=light` or `?theme=dark` to match the app's
color scheme.

Four ways to present it:

**Full-page redirect** (simplest):

```typescript
const cart = await henry.cart.create({ items });
res.redirect(cart.data.checkoutUrl); // or window.location.href client-side
```

**Iframe embed** — keep users on the page and listen for completion via
`postMessage`. Always check the event origin:

```typescript
document.getElementById("henry-checkout").src = cart.data.checkoutUrl;

window.addEventListener("message", (event) => {
  if (!event.origin.endsWith(".henrylabs.ai")) return;
  const { action, orderId } = event.data ?? {};
  if (action === "orderCompleted") showOrderConfirmation(orderId);
  else if (action === "checkoutClosed") hideCheckout();
});
```

The iframe should carry `allow="payment"`.

**Modal popup** — `window.open(checkoutUrl, "henry-checkout", "width=520,height=750")`
with the same `message` listener; close the popup on `orderCompleted` /
`checkoutClosed`.

**React Native** — render the `checkoutUrl` in `react-native-webview` and
handle `onMessage`, parsing `event.nativeEvent.data` for the same
`{ action, orderId }` shape.

## Headless checkout

Full UI control: collect shipping and payment in your own UI, then call
Henry server-side. **Requires special enablement — contact
support@henrylabs.ai before building.**

Card details must be tokenized client-side with Henry's Card Element (see
the client SDK docs at <https://docs.henrylabs.ai>); pass the resulting
`cardToken` to the purchase call. Raw card numbers never touch your server.

```typescript
const purchase = await henry.cart.checkout.purchase({
  cartId,
  buyer: {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com",
    phone: "+19175551234",
    shippingAddress: {
      line1: "350 5th Ave",
      line2: "Floor 21",
      city: "New York",
      province: "NY",
      postalCode: "10118",
      countryCode: "US",
    },
    card: {
      nameOnCard: { firstName: "Jane", lastName: "Doe" },
      details: { cardToken: "..." },
      // billingAddress optional — defaults to shippingAddress
    },
  },
});
```

Poll every ~2 seconds until terminal:

```typescript
let order = purchase;
while (order.status === "pending" || order.status === "processing") {
  await new Promise((r) => setTimeout(r, 2000));
  order = await henry.cart.checkout.pollPurchase({ refId: purchase.refId });
}
if (order.status === "complete") {
  const { subtotal, commissionFee, total } = order.result.costs;
}
```

Adjust quantities at purchase time without mutating the cart via
`overrideProducts`: a map of product `link` → new quantity, or `null` to
exclude the item from this purchase.

## Order tracking: webhooks first, polling as fallback

**Webhooks** (recommended in production): register an endpoint in the
[Henry Dashboard](https://app.henrylabs.ai) (app settings → webhooks). Henry
issues a **webhook UUID** (referenced from cart settings) and a **webhook
secret** (used to verify requests — keep it private).

Attach the webhook to a cart at creation:

```typescript
const cart = await henry.cart.create({
  items,
  settings: {
    events: [
      {
        type: "order.purchase.full.complete",
        data: [{ type: "send_webhook", webhookUUID: "<your-webhook-uuid>" }],
      },
    ],
  },
});
```

Useful event types (the full list is in the Universal Cart guide): `order.purchase`
(any purchase update), `order.purchase.complete`, `order.purchase.cancelled`,
`order.purchase.full.complete` (all items placed), `order.item.failed`
(item-level failures). Actions besides `send_webhook` include `send_email`
and points/tier actions for loyalty programs.

Verify every delivery. Henry sends `X-Henry-Signature` (HMAC-SHA256 hex of
`{timestamp}.{body}` using the webhook secret) and `X-Henry-Timestamp`
(Unix ms). Recompute the HMAC over the **raw body**, compare with
`timingSafeEqual`, and reject stale timestamps (e.g. older than 5 minutes):

```typescript
import { createHmac, timingSafeEqual } from "crypto";

function verifyHenryWebhook(rawBody, signature, timestamp) {
  if (!signature || !timestamp) return false;
  if (Date.now() - Number(timestamp) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", process.env.HENRY_WEBHOOK_SECRET)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return (
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}
```

Handle the payload `{ event, data }` — e.g. `order.purchase.full.complete`
carries `data.refId` and `data.result.costs`.

**Polling fallback**: `orders.list({ cartId })` on an interval until the
order reaches `complete` or `cancelled` (statuses and the
items-may-individually-fail nuance are in api-reference.md).

## Sandbox vs production

- **Keys are environment-specific.** Generate **sandbox** keys self-serve in
  the [Henry Dashboard](https://app.henrylabs.ai); request **production**
  keys from your Henry contact.
- Sandbox exercises the full flow — search, cart, hosted and headless
  checkout — with test data and test card numbers, no real charges.
- The SDK targets Henry's production API by default; the
  `HENRY_SDK_BASE_URL` environment variable overrides the base URL if Henry
  support directs you to a different environment host.
- The `HENRY_SDK_API_KEY` environment variable is the conventional place for
  the key; the SDK reads it via the `apiKey` client option.

## Go-live checklist

1. Swap the sandbox key for a production key (environment variable only —
   no code change).
2. Re-verify the webhook endpoint is registered for the production app and
   the secret is set in the production environment.
3. Confirm commission settings (`commissionFeePercent` /
   `commissionFeeFixed`) on cart creation are what you intend.
4. Run one real end-to-end order and confirm the webhook (or
   `orders.list`) reports `complete` with populated `result.costs`.
