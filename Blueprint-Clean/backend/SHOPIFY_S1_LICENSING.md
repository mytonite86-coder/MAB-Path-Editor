# M.A.B. S1 Shopify license delivery

This backend implements local-ready, production-disabled fulfillment for the
M.A.B. S1 one-time Shopify product. It does not change Shopify, send a live
email, or activate production by itself.

## Verified product boundary

- Product ID: `15428412571927`
- Variant ID: `67773605544215`
- Entitlement granted after code redemption: `mab_s1`
- License type: permanent M.A.B. S1 access only
- M.A.B. S2 is excluded

An `orders/paid` webhook must pass all of these checks before a license is
issued or delivered:

1. Valid Shopify HMAC over the raw request body.
2. Exact `orders/paid` topic.
3. Exact trusted internal `.myshopify.com` domain.
4. Numeric Shopify order ID.
5. Paid, not cancelled, not refunded, and not previously placed on commerce
   review hold.
6. Exact product ID and variant ID match.
7. Positive integer quantity.
8. Valid purchaser email address.

One encrypted, recoverable activation code is stored per Shopify order license
unit. A hashed copy is used for redemption. The plaintext code is never
returned by a webhook or public API and must not be logged.

Duplicate paid webhooks reuse the existing license records. Delivery uses an
atomic claim; a failed attempt leaves the same encrypted code retryable rather
than issuing another code or sending another license unit. Delivered records
are not sent again. Cancellation and refund webhooks place matching orders and
licenses into manual commerce review without automatically revoking an already
granted permanent entitlement.

## Required production environment

These values must be configured through the production environment, never in
source control:

- `SHOPIFY_WEBHOOK_SECRET`
- `SHOPIFY_SHOP_DOMAIN`
- `MAB_ACTIVATION_ENCRYPTION_KEY` (a stable Fernet key; loss prevents delivery
  recovery)
- `MAB_LICENSE_SMTP_HOST`
- `MAB_LICENSE_SMTP_PORT` (defaults to `587`)
- `MAB_LICENSE_SMTP_STARTTLS` (`true` or `false`, defaults to `true`)
- `MAB_LICENSE_FROM_EMAIL`
- `MAB_LICENSE_SMTP_USERNAME` and `MAB_LICENSE_SMTP_PASSWORD` (both or neither,
  depending on the SMTP service)

Before production activation, confirm the internal Shopify domain in Shopify
Admin and set `SHOPIFY_SHOP_DOMAIN` explicitly. The current local contract uses
`vd1k2v-ew.myshopify.com`; that value has not been live-confirmed in this work
block.

## Webhooks to register before activation

- `orders/paid` -> `/api/shopify/webhooks/orders-paid`
- `orders/cancelled` -> `/api/shopify/webhooks/orders-cancelled`
- `refunds/create` -> `/api/shopify/webhooks/refunds-create`

Production activation also requires a controlled non-charge delivery test with
the selected SMTP service, a verified webhook registration test, and confirmation
that the encryption key is backed up securely. No live order or customer email
was used during local validation.
