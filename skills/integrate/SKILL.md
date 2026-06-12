---
name: integrate
description: >-
  Integrate Henry's agentic-commerce API into an app, agent, or backend.
  Covers installing @henrylabs/sdk, API keys, cross-merchant product search,
  universal carts, hosted and headless checkout, async job polling, webhooks,
  and order tracking. Use whenever the user wants to add shopping, commerce,
  carts, checkout, or product search to something they are building; asks how
  to use the Henry SDK, Henry API, or @henrylabs packages; mentions
  HENRY_SDK_API_KEY or henrylabs.ai; or is building a shopping agent or
  commerce integration. Read this BEFORE writing any code that calls Henry.
---

# Integrate Henry

Henry gives an application a full commerce stack behind a single API key:
search any merchant's catalog, build multi-merchant carts, launch checkout,
and track orders. Features are modular — you can call
`cart.checkout.purchase` directly with a product link, or use
`products.details` standalone without ever touching a cart.

## Setup in three steps

1. **API key**: create an app in the [Henry Dashboard](https://app.henrylabs.ai)
   and copy its API key (Developer settings). Start with a sandbox key.
2. **Install**: `npm i @henrylabs/sdk` (or `bun add` / `pnpm add` / `yarn add`).
3. **Initialize** (server-side):

```typescript
import HenrySDK from "@henrylabs/sdk";

const henry = new HenrySDK({ apiKey: process.env.HENRY_SDK_API_KEY });
```

> **The API key is server-side only.** Never expose it in browser or mobile
> code, and never hardcode it — read it from the environment.

## The async-jobs mental model

Product search, product details, and checkout operations are **async jobs**:
the initial call returns `{ refId, status }` immediately, and results arrive
when background work completes. Poll the matching `poll*` method until a
terminal status, or use webhooks instead of polling.

| Status | Meaning |
| --- | --- |
| `pending` | Queued, not started yet |
| `processing` | Actively running |
| `complete` | Results are ready in `result` |
| `failed` | Unrecoverable error — check the `error` field |

The canonical polling helper (reuse for every async method):

```typescript
async function pollUntilDone<T extends { status: string; refId: string }>(
  initial: T,
  poll: (args: { refId: string }) => Promise<T>,
  intervalMs = 1000,
): Promise<T> {
  let current = initial;
  while (current.status === "pending" || current.status === "processing") {
    await new Promise((r) => setTimeout(r, intervalMs));
    current = await poll({ refId: initial.refId });
  }
  return current;
}
```

Cache `refId`s — you can re-poll any time to retrieve results without
re-running the job.

## The shopping flow (minimal end-to-end)

Search returns products with a `link`; the `link` is the cart item
identifier (no separate product ID). `cart.create` returns a `checkoutUrl`
immediately — hosted checkout needs no extra setup step.

```typescript
const search = await henry.products.search({ query: "Nike Air Max", limit: 10 });
const done = await pollUntilDone(search, (a) => henry.products.pollSearch(a));
const first = (done.result?.products ?? [])[0];

const cart = await henry.cart.create({
  items: [{ link: first.link, quantity: 1, variant: { size: "10" } }],
});
const { cartId, checkoutUrl } = cart.data;
// Send the user to checkoutUrl — Henry handles payment, address, and tax.
```

## Choose a checkout mode

| Mode | How | When |
| --- | --- | --- |
| **Hosted** | Send the buyer to the `checkoutUrl` from `cart.create` (redirect, iframe, popup, or WebView) | Default. Fastest to ship; Henry collects shipping, payment, tax; zero PCI burden |
| **Headless** | Server-side `cart.checkout.purchase` with buyer info + tokenized card | Full UI control (e.g. voice agents, native checkout). **Requires enablement** — contact support@henrylabs.ai |

Before implementing either mode, read
[references/checkout-and-environments.md](references/checkout-and-environments.md).

## Monetization

Every completed order can generate a commission for the application:
configure `commissionFeePercent` and/or `commissionFeeFixed` in the
`settings` object of `cart.create`. Henry handles payout calculation and
reporting.

## Where to look next

- About to call a specific endpoint (search filters, cart item fields, order
  filters, polling, errors)? Read
  [references/api-reference.md](references/api-reference.md).
- Building checkout UI, webhooks, or going to production? Read
  [references/checkout-and-environments.md](references/checkout-and-environments.md).
- Full docs and live API playground: <https://docs.henrylabs.ai>. Henry also
  offers an MCP server (`npx -y @henrylabs/mcp@latest`) and a remote
  OAuth-based MCP server for end-user-facing assistants — see the docs site.

## Guardrails

- API key stays server-side; load it from the environment.
- Poll at ~1–2s intervals (use ~2s for purchase jobs); always handle the
  `failed` status and surface the `error` field.
- Prefer webhooks over polling in production for order tracking.
- Develop against a sandbox key; switch to a production key only at go-live.
- Don't invent API fields — confirm shapes in the reference files or at
  <https://docs.henrylabs.ai>.
