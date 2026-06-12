---
name: shop
description: >-
  Shop with Henry: searches real products across merchants, builds a cart, and
  returns a hosted checkout link. Use when the user explicitly wants to buy or
  shop for something. In Claude Code, run as /henry:shop <what you want to buy>.
disable-model-invocation: true
---

# Shop with Henry

The user's shopping request: $ARGUMENTS

If the request above is empty (or the `$ARGUMENTS` placeholder was not
interpolated by this client), use the user's last message as the request. If
there is still no concrete request, ask what they want to buy and stop.

## Step 0 — Parse the request

Extract from the request:

- the search query (what to buy)
- optional constraints: max/min price, merchant (e.g. "from nike.com"),
  quantity, variant hints (size, color)

## Step 1 — Preflight: confirm Henry tools are available

Henry's MCP server exposes one of two tool surfaces depending on version.
Match tool names by **suffix** (clients prefix MCP tool names differently —
never hardcode a `mcp__...__` prefix):

- **Per-endpoint surface**: tools like `search_products`,
  `retrieve_product_details`, `add_cart_items`, `list_cart_items`,
  `remove_cart_items`, `create_cart_checkout`, `retrieve_status_orders`.
- **Code-mode surface**: tools named like `execute` (runs TypeScript against
  `@henrylabs/sdk` in a sandbox) and `search_docs` (searches the SDK docs).

If **neither** surface is present, the Henry MCP server is not configured.
Walk the user through setup, then stop and ask them to re-run this skill:

1. Get a **sandbox** API key: create an app at <https://app.henrylabs.ai>,
   then open the app's Developer settings.
2. Add the Henry MCP server to this client:
   - Claude Code:
     `claude mcp add henry -e HENRY_SDK_API_KEY=<key> -- npx -y @henrylabs/mcp@latest`
   - Other MCP clients (Cursor, Codex, etc.) — add a stdio server:
     `command: "npx"`, `args: ["-y", "@henrylabs/mcp@latest"]`,
     `env: { "HENRY_SDK_API_KEY": "<key>" }`
3. Re-run the shopping request.

If tools exist but calls fail with a connection error or 401 / authentication
error, the API key is missing or invalid:

1. Get a sandbox key as above.
2. `export HENRY_SDK_API_KEY="<key>"` in the terminal that launches this
   client (add to the shell profile to persist).
3. In Claude Code, run `/mcp` and reconnect the `henry` server; in other
   clients, restart the MCP server or the client (env vars are read at server
   launch).
4. Re-run the shopping request.

Never ask the user to paste their API key into the chat, and never fabricate
results while tools are unavailable.

## Step 2 — Search

- Per-endpoint surface: call `search_products` with the query and any parsed
  filters (merchant, min/max price, ~10 results). If the response is an async
  job (`refId` with `status: pending|processing`) rather than a product list,
  poll its status tool every ~2s for up to ~60s until `complete` or `failed`.
- Code-mode surface: one code-execution call that runs
  `henry.products.search(...)`, polls `henry.products.pollSearch(refId)` in a
  loop (~2s interval, ~60s cap), and returns the products array.

## Step 3 — Present results

Show a compact markdown table, max 8 rows:

| # | Product | Price | Merchant | In stock |
|---|---------|-------|----------|----------|

Format price from the product's `price.value` and `price.currency`; stock from
`availability`. Keep each product's `link` — it is the cart item identifier.
Ask which item(s) to add, unless the request already pins one unambiguous
product and quantity — then proceed.

## Step 4 — Variants (only when needed)

If the chosen product needs a size/color the user didn't specify, fetch
product details for its `link` (also an async job — poll the same way), list
the available variants briefly, and ask. Skip details otherwise — search
results are enough to buy.

## Step 5 — Build the cart

- Per-endpoint surface: `add_cart_items` with
  `{ link, quantity, variant? }`. Reuse the returned `cartId` for further adds
  in this session.
- Code-mode surface: `henry.cart.create({ items: [...] })` or
  `henry.cart.item.add(...)` for an existing cart.

## Step 6 — Checkout link

Get the hosted checkout URL (`create_cart_checkout`, or the `checkoutUrl`
already returned by `henry.cart.create`). This skill is **hosted-checkout
only**: never attempt a headless purchase, and never collect addresses or
card details in chat — Henry's hosted checkout page handles that.

## Step 7 — Present the result

Short summary table of cart contents with line prices, then the checkout URL
prominently on its own line:

> **Checkout here:** <checkout URL>

On a sandbox key, note this is a test checkout and no real charge occurs.

## Step 8 — Offer order tracking

After the user completes checkout, offer to check status (`orders` tools or
`henry.orders.list({ cartId })`). Report the order status progression
(`pending` → `processing` → `complete`/`cancelled`) and the final costs on
completion.

## Failure handling

| Symptom | Action |
|---------|--------|
| Henry tools absent | Run the Step 1 server setup, then stop |
| 401 / authentication error | Run the Step 1 key onboarding, then stop |
| Job `status: "failed"` | Surface the job's `error`, retry once, then suggest rephrasing |
| Poll exceeds ~60s | Say it's still processing; offer to keep waiting |
| Empty results | Suggest broadening the query or dropping filters |
| Anything else | Never fabricate products, prices, or checkout URLs — only show what the API returned |
