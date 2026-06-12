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
| `henry.cart.list(params?)` | `GET /cart` (all) / fetch by `cartId` | sync |
| `henry.cart.item.add({ cartId, item })` | `POST /cart/{cartId}/item` | sync |
| `henry.cart.item.update({ cartId, item })` | `PUT /cart/{cartId}/item` | sync |
| `henry.cart.item.remove({ cartId, link })` | `DELETE /cart/{cartId}/item` | sync |
| `henry.cart.delete({ cartId })` | `DELETE /cart/{cartId}` | sync |
| `henry.cart.checkout.details({ cartId, ... })` | `POST /cart/{cartId}/details` | async job |
| `henry.cart.checkout.pollDetails({ refId })` | `GET /cart/checkout/status` | poll |
| `henry.cart.checkout.purchase({ cartId, buyer })` | `POST /cart/{cartId}/purchase` | async job |
| `henry.cart.checkout.pollPurchase({ refId })` | `GET /cart/purchase/status` | poll |
| `henry.merchants.list(params?)` | `GET /merchants` | sync |
| `henry.orders.list(params?)` | `GET /orders` | sync |

Async jobs return `{ refId, status }` immediately; poll until `complete` or
`failed` (see the polling pattern at the bottom).

## Product search — `products.search`

| Parameter | Type | Description |
| --- | --- | --- |
| `query` | `string` | **Required.** Full-text search term |
| `merchant` | `string` | Merchant name or host to scope the search (e.g. `"nike.com"`) |
| `limit` | `number` | Results per page — 1 to 100, default 20 |
| `cursor` | `number` | Pagination cursor from a previous response |
| `sortBy` | `"lowToHigh" \| "highToLow"` | Sort by price |
| `minPrice` / `maxPrice` | `number` | Price filters |
| `country` | `string` | ISO country code for regional results (e.g. `"US"`) |

Reading results:

```typescript
const { products, pagination } = result.result;
for (const product of products) {
  product.name;
  product.price.value;        // "150.00"
  product.price.currency;     // "USD"
  product.merchant;           // "nike.com"
  product.link;               // use as the cart item `link`
  product.availability;       // "in_stock" etc.
}
// Next page: pass `cursor: Number(pagination.nextCursor)` to a new search.
```

## Product details — `products.details`

Takes the product `link` from search (not an ID). Returns the enriched
product: all variants, rich images, live availability.

| Parameter | Type | Description |
| --- | --- | --- |
| `link` | `string` | **Required.** Direct product URL |
| `variant` | `string \| object` | Optional variant pre-select, e.g. `{ size: "10", color: "Black" }` |
| `country` | `string` | Optional ISO country code |

Henry caches details internally — if details for a `link` are fresh,
`pollDetails` can return `complete` on the very first poll.

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
| `variant` | `string \| object` | – | Instruction string or key/value pairs, e.g. `{ size: "10" }` |
| `shippingOption` | `{ id?, value? }` | – | Preferred shipping method |
| `coupons` | `string[]` | – | Coupon codes to apply at checkout |
| `metadata` | `object` | – | Arbitrary data passed through to orders |

Cart settings (`cart.create` → `settings`):

| Field | Type | Description |
| --- | --- | --- |
| `options.allowPartialPurchase` | `boolean` | Let buyers remove items during checkout |
| `options.collectBuyerEmail` | `"off" \| "required" \| "optional"` | Email collection behavior |
| `options.collectBuyerAddress` | `"off" \| "required" \| "optional"` | Address collection behavior |
| `options.collectBuyerPhone` | `"off" \| "required" \| "optional"` | Phone collection behavior |
| `commissionFeePercent` | `number` | Commission as % of order total (0–100) |
| `commissionFeeFixed` | `{ value, currency }` | Fixed commission added to the order |
| `events` | `CartEvent[]` | Lifecycle triggers (webhooks, points, tiers) — see checkout-and-environments.md |

Item management: `cart.item.add` (returns the updated cart),
`cart.item.update` (set a new `quantity`; `0` removes the item),
`cart.item.remove` (by `link`). Fetch current state any time with
`cart.list({ cartId })` — the `checkoutUrl` stays valid. `cart.delete`
removes the cart entirely.

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
| `status` | `"pending" \| "processing" \| "complete" \| "cancelled"` | – | Filter by status |
| `cartId` | `string` (UUID) | – | Only orders from this cart |

Order statuses:

| Status | Meaning | Terminal? |
| --- | --- | --- |
| `pending` | Payment not yet confirmed | No |
| `processing` | Payment accepted, placing items with merchants | No |
| `complete` | **Every item concluded its purchase attempt** — some may have succeeded, others failed; check each item's status individually. `result.costs` is populated | Yes |
| `cancelled` | Cancelled at some stage — `error` has details | Yes |

```typescript
const { data: orders } = await henry.orders.list({ cartId });
orders[0]?.result?.costs.total; // { value: 149.99, currency: "USD" }
```

## Merchants — `merchants.list`

Browse supported merchants (every product `link` belongs to a merchant
`host` like `nike.com`). Useful for building merchant filters before search
or cart creation.

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
