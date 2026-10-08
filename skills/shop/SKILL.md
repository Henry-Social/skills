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

If the user names a merchant that isn't a host, call `merchantsSearch` with
`{ q: "<name>" }` to resolve it to a host before scoping the search.

## Step 1 — Preflight: confirm Henry tools are available

Henry's remote MCP server (`https://mcp.henrylabs.ai/mcp`) exposes one tool
per API operation. Match tool names by **suffix** (clients prefix MCP tool
names differently — never hardcode a `mcp__...__` prefix): `productSearch`,
`productSearchStatus`, `productDetails`, `productDetailsStatus`, `cartCreate`,
`cartAddItem`, `cartFetch`, `ordersList`, `merchantsSearch` (and
`merchantsRetrieve` / `merchantsList` for coverage). Only the first group is
required.

If they are **absent**, the Henry MCP server is not configured. Walk the user
through setup, then stop and ask them to re-run this skill:

1. Get a **sandbox** API key: create an app at <https://app.henrylabs.ai>,
   then open the app's Developer settings.
2. Add the Henry MCP server to this client:
   - Claude Code:
     `claude mcp add --transport http henry https://mcp.henrylabs.ai/mcp --header "x-api-key: $HENRY_SDK_API_KEY"`
   - Other MCP clients (Cursor, Codex, etc.) — add a remote (Streamable
     HTTP) server with URL `https://mcp.henrylabs.ai/mcp` and the header
     `x-api-key: <key>` (or `Authorization: Bearer <key>`).
3. Re-run the shopping request.

If tools exist but calls fail with a 401 / authentication error, the API key
is missing or invalid:

1. Get a sandbox key as above.
2. `export HENRY_SDK_API_KEY="<key>"` in the terminal that launches this
   client (add to the shell profile to persist).
3. In Claude Code, run `/mcp` and reconnect the `henry` server; in other
   clients, restart the client so the header picks up the key.
4. Re-run the shopping request.

Never ask the user to paste their API key into the chat, and never fabricate
results while tools are unavailable.

## Step 2 — Search

Call `productSearch` with `limit: 10` and one of:

- Any merchant: `{ type: "global", filters: { type: "text", query } }`.
  Add `filters.merchants: ["a.com", "b.com"]` to limit it to several hosts,
  and `filters.supportedOnly: true` to return only merchants Henry can check
  out (use it unless the user names a merchant).
- One merchant: `{ type: "merchant", filters: { merchant: "nike.com" }, query }`
  (`query` is optional and sits at the top level).

Price goes in `filters.price`: `{ min, max }`. Sold-out products are dropped
by default; set `filters.includeOutOfStock: true` (merchant search) only if
the user wants them.

It returns an async job (`refId` with `status: processing`): poll
`productSearchStatus` with that `refId` every ~2s for up to ~60s until
`complete` or `failed`, then read the products from its result. A page can
hold fewer than `limit` products; if it's short or empty and `nextCursor` is
not null, search again with `cursor: nextCursor`.

## Step 3 — Present results

Show a compact markdown table, max 8 rows:

| # | Product | Price | Merchant | In stock |
|---|---------|-------|----------|----------|

Format price from the product's `price.value` and `price.currency`; stock from
`availability`. Keep each product's `link` — it is the cart item identifier.
Ask which item(s) to add, unless the request already pins one unambiguous
product and quantity — then proceed.

## Step 4 — Variants (only when needed)

If the chosen product needs a size/color the user didn't specify, call
`productDetails` for its `link` (also an async job — poll
`productDetailsStatus` the same way), list
the available variants briefly, and ask. Skip details otherwise — search
results are enough to buy.

## Step 5 — Build the cart

Call `cartCreate` with `{ items: [{ link, quantity, selectedOptions? }] }`.
Reuse the returned `cartId` for further adds in this session via
`cartAddItem`.

## Step 6 — Checkout link

Use the `checkoutUrl` returned by `cartCreate` (or `cartFetch` for an
existing cart). This skill is **hosted-checkout
only**: never attempt a headless purchase, and never collect addresses or
card details in chat — Henry's hosted checkout page handles that.

## Step 7 — Present the result

Short summary table of cart contents with line prices, then the checkout URL
prominently on its own line:

> **Checkout here:** <checkout URL>

On a sandbox key, note this is a test checkout and no real charge occurs.

## Step 8 — Offer order tracking

After the user completes checkout, offer to check status with `ordersList`
filtered by `cartId`. Report the order status progression
(`pending` → `processing` → `complete`, `partially_complete`, `failed` or
`cancelled`) and the final costs once it's `complete` or
`partially_complete`.

## Failure handling

| Symptom | Action |
|---------|--------|
| Henry tools absent | Run the Step 1 server setup, then stop |
| 401 / authentication error | Run the Step 1 key onboarding, then stop |
| Job `status: "failed"` | Surface the job's `error`, retry once, then suggest rephrasing |
| Poll exceeds ~60s | Say it's still processing; offer to keep waiting |
| Empty results | Suggest broadening the query or dropping filters |
| Anything else | Never fabricate products, prices, or checkout URLs — only show what the API returned |
