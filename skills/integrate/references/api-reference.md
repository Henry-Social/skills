# Henry API reference (condensed)

Distilled from the v1 OpenAPI spec and <https://docs.henrylabs.ai>. All SDK
methods live on a `HenrySDK` client instance (`henry` below). All endpoints
require the `x-api-key` header — the SDK sets it from the `apiKey` option.

## Method ↔ endpoint map

| SDK method | Endpoint | Kind |
| --- | --- | --- |
| `henry.products.search(params)` | `POST /product/search` | async job |
| `henry.products.pollSearch({ refId })` | `GET /product/search/status` | poll |
| `henry.products.details(params)` | `POST /product/details` | async job |
| `henry.products.pollDetails({ refId })` | `GET /product/details/status` | poll |
| `henry.cart.create({ items, settings? })` | `POST /cart` | sync |
| `henry.cart.fetch(cartId, { buyer? })` | `POST /cart/{cartId}` | sync |
| `henry.cart.list(params?)` | `GET /cart` (list/filter carts) | sync |
| `henry.cart.item.add(cartId, { item })` | `POST /cart/{cartId}/item` | sync |
| `henry.cart.item.update(cartId, { item })` | `PUT /cart/{cartId}/item` | sync |
| `henry.cart.item.remove(cartId, { link })` | `DELETE /cart/{cartId}/item` | sync |
| `henry.cart.delete(cartId)` | `DELETE /cart/{cartId}` | sync |
| `henry.cart.checkout.details(cartId, { buyer: { shippingAddress }, ... })` | `POST /cart/{cartId}/details` | async job |
| `henry.cart.checkout.pollDetails({ refId })` | `GET /cart/checkout/status` | poll |
| `henry.cart.checkout.purchase(cartId, { buyer, ... })` | `POST /cart/{cartId}/purchase` | async job |
| `henry.cart.checkout.pollPurchase({ refId })` | `GET /cart/purchase/status` | poll |
| `henry.merchants.list(params?)` | `GET /merchants` | sync |
| `henry.merchants.retrieve(host)` | `GET /merchants/{host}` | sync |
| `henry.merchants.search({ q })` | `GET /merchants/search` (typeahead) | sync |
| `henry.orders.list(params?)` | `GET /orders` | sync |
| `henry.card.tokenize(params)` | `POST /card/tokenize` | sync |
| `henry.card.issue(params)` | `POST /card/issue` (beta, per-account) | sync |
| `henry.card.retrieve(cardToken)` | `GET /card/{cardToken}` | sync |
| `henry.card.reveal(cardToken)` | `POST /card/{cardToken}/reveal` | sync |
| `henry.card.close(cardToken)` | `POST /card/{cardToken}/close` | sync |
| `henry.card.updateCvv(cardToken, { cvv })` | `POST /card/{cardToken}/cvv` | sync |

Async jobs return `{ refId, status }` immediately; poll until `complete` or
`failed` — purchases can also settle `partially_complete` (see the polling
pattern at the bottom).

## Product search — `products.search`

Params are `{ type, filters, ... }`:

```typescript
henry.products.search({
  type: "global",
  filters: { type: "text", query: "Nike Air Max" },
  limit: 10,
});
henry.products.search({
  type: "merchant",
  filters: { merchant: "nike.com" },
  query: "running shoes", // optional
});
```

| Parameter | Type | Description |
| --- | --- | --- |
| `type` | `"global" \| "merchant"` | **Required.** Search scope |
| `filters` | `object` | **Required.** Depends on `type` (below) |
| `query` | `string` | Merchant scope only: optional text query. Omit to browse the catalog |
| `limit` | `number` | 1–100, default 20 |
| `cursor` | `number` | `pagination.nextCursor` from a previous response |
| `mode` | `"async" \| "sync"` | Default `async`; `sync` waits up to 30s |
| `skipCache` | `boolean` | Bypass cached results |

Global `filters` — text (`type: "text"`) or image (`type: "image"`):

| Filter | Applies to | Description |
| --- | --- | --- |
| `query` | text | **Required.** Search text |
| `imageUrl` | image | **Required.** HTTP(S) URL, data URL or base64 image |
| `country` | both | ISO country code, e.g. `"US"` |
| `price` | text | `{ min?, max?, currency? }`, inclusive |
| `sortBy` | text | `"price-low-to-high" \| "price-high-to-low"` |
| `supportedOnly` | both | Only merchants Henry can check out |
| `merchants` | text | 1–50 hosts/URLs to restrict the search to; unmatched entries are skipped |

Merchant `filters`:

| Filter | Description |
| --- | --- |
| `merchant` | **Required.** Host (`"nike.com"`), name or URL |
| `country` | ISO country code; matters for regional merchants |
| `price` / `sortBy` | As above; sort is best-effort per merchant |
| `options` | Variant name → value, e.g. `{ size: "M" }`. Valid names/values: `searchFilters` from `merchants.retrieve` |
| `includeOutOfStock` | Keep sold-out products (dropped by default) |
| `imageUrl` | Search the merchant's catalog by image instead of text |

`supportedOnly`, `merchants` and `includeOutOfStock` can return pages shorter
than `limit` — page until `nextCursor` is `null`, not until a page is short.

Reading results:

```typescript
const { products, pagination } = result.result;
for (const product of products) {
  product.name;
  product.price.value;        // 150 (number)
  product.price.currency;     // "USD"
  product.originalPrice;      // pre-discount price, when known
  product.merchant;           // "nike.com"
  product.link;               // use as the cart item `link`
  product.availability;       // "in_stock" etc.
}
// Next page: pass `cursor: pagination.nextCursor` to a new search;
// stop when it is `null`.
```

## Product details — `products.details`

Takes the product `link` from search (not an ID). Returns the enriched
product: all variants, rich images, live availability.

| Parameter | Type | Description |
| --- | --- | --- |
| `link` | `string` | **Required.** Direct product URL |
| `selectedOptions` | `string[]` | Optional. Returns that variant's price, images and availability. One value per option, in the order of `result.options`, spelled as the store spells them, e.g. `["Black", "10"]`. Skips the details cache |
| `country` | `string` | Optional ISO country code |

Henry caches details internally — if details for a `link` are fresh,
`pollDetails` can return `complete` on the very first poll.

`result.options` lists the product's options as a tree. Each level has a
`label` (for example `Color`) and `values`. Each value has a `value`, the text
to pass, and a `nextOption` with the next level when there is one. To build
`selectedOptions`, pick one `value` at each level, in order. If
`options.status` is `unknown`, Henry couldn't read the product's options.

## Cart

`cart.create` takes `items[]` and optional `settings`; the response includes
both identifiers you need:

```typescript
const cart = await henry.cart.create({ items: [{ link, quantity: 1 }] });
const { cartId, checkoutUrl } = cart.data; // checkoutUrl is ready immediately
```

Cart item fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `link` | `string` | ✅ | Direct product URL from any merchant |
| `quantity` | `number` | – | Defaults to 1 |
| `selectedOptions` | `string[]` | – | One value for each of the product's options, such as color and then size, copied from `result.options` in `products.details` (see above), e.g. `["Black", "10"]`. If a value doesn't match the store's option, Henry can buy a different variant without an error. Unknown fields like `variant` are ignored |
| `selectedShipping` | `{ id?, value? }` | – | Preferred shipping method |
| `coupons` | `string[]` | – | Coupon codes to apply at checkout |
| `metadata` | `object` | – | Arbitrary data passed through to orders |

Cart settings (`cart.create` → `settings`):

| Field | Type | Description |
| --- | --- | --- |
| `options.allowPartialPurchase` | `boolean` | Let buyers remove items during checkout |
| `options.collectBuyerEmail` | `"off" \| "required" \| "optional"` | Email collection behavior |
| `options.collectBuyerAddress` | `"off" \| "required" \| "optional"` | Address collection behavior |
| `options.collectBuyerPhone` | `"off" \| "required" \| "optional"` | Phone collection behavior |
| `serviceFeePercent` | `number` | Service fee as % of order total (0–100) |
| `serviceFeeFixed` | `{ value, currency }` | Fixed service fee added to the order |
| `events` | `CartEvent[]` | Lifecycle triggers (webhooks, points, tiers) — see checkout-and-environments.md |

Item management: `cart.item.add` (returns the updated cart),
`cart.item.update` (set a new positive-integer `quantity`),
`cart.item.remove` (by `link`; to drop an item use this, not quantity `0`).
Fetch current state any time with `cart.fetch(cartId, { buyer? })` — the
`checkoutUrl` stays valid, and passing `buyer` prefills it. `cart.list`
lists/filters carts. `cart.delete` removes the cart entirely.

## Checkout details — `cart.checkout.details`

Async job that retrieves live checkout information for a cart from the
merchant(s) — shipping options and cost estimates — before committing to a
purchase. Poll with `cart.checkout.pollDetails({ refId })`. Use when you
need to show real shipping/cost data in a custom UI ahead of checkout.

## Orders — `orders.list`

Returns the application's orders, newest first, with cursor pagination.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | `number` | 20 | Results per page (1–100) |
| `cursor` | `string` | – | Pagination cursor from a previous response |
| `status` | `"pending" \| "processing" \| "complete" \| "partially_complete" \| "failed" \| "cancelled"` | – | Filter by status |
| `cartId` | `string` | – | Only orders from this cart |

Order statuses:

| Status | Meaning | Terminal? |
| --- | --- | --- |
| `pending` | Payment not yet confirmed | No |
| `processing` | Payment accepted, placing items with merchants | No |
| `complete` | Every item was purchased. `result.costs` is populated | Yes |
| `partially_complete` | Some items were purchased, the rest failed — check each item's status. `result.costs` covers the purchased items | Yes |
| `failed` | No items were purchased — `error` has details | Yes |
| `cancelled` | Cancelled at some stage — `error` has details | Yes |

After an item fails, an order can stay `processing` for up to an hour
before it settles, so its settled status is always final.

```typescript
const { data: orders } = await henry.orders.list({ cartId });
orders[0]?.result?.costs.total; // { value: 149.99, currency: "USD" }
```

## Merchants — `merchants.list`

Browse supported merchants (every product `link` belongs to a merchant
`host` like `nike.com`). Useful for building merchant filters before search
or cart creation. `merchants.list` filters: `checkoutCoverage`,
`productSearchCoverage`, `productDetailsCoverage` (`supported` | `testing` |
`unsupported`), `categories`, `name`, `host` (`coverageStatus` is
deprecated). `merchants.search({ q })` resolves a typed name to a host;
`merchants.retrieve(host)` returns coverage and `searchFilters`.

## Polling pattern

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

- ~1s interval for search/details; ~2s for purchase jobs.
- Polling is idempotent — cache the `refId` and re-poll any time.
- Prefer webhooks in production (see checkout-and-environments.md).

## Errors

| Error | Cause | Resolution |
| --- | --- | --- |
| `401 Unauthorized` | Invalid API key | Check `HENRY_SDK_API_KEY` |
| `400 Bad Request` | Missing/invalid params (e.g. no `query`, bad `link` URL, out-of-range `limit`) | Validate input before calling |
| `404 Not Found` | `cartId` doesn't exist or belongs to a different app | Re-create or re-fetch the cart |
| Job `status: "failed"` | Background job error | Log the job's `error` field and retry |

The SDK throws typed `APIError` subclasses, automatically retries
connection errors, 408, 409, 429, and 5xx (configurable via `maxRetries`),
and applies a default request timeout of about a minute.
