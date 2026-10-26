# S&K Shopify paid-order email fulfillment

The paid-order route is now product-aware. This is a backend-only change. It
does not implement scheduling, calendars, the booking UI, or M.A.B. app changes.

## Routes and message sections

- M.A.B. S1 product `15428412571927` / variant `67773605544215`:
  send the original single-use MAB1- license code, the M.A.B. login path,
  instructions to choose Submit Activation Code (the Activate Access panel),
  and the exact `mab_s1` entitlement.
- S&K service: catalog-matched S&K service product ID or SKU beginning with
  `SK-SVC-`: ask for the desired work day or deadline, explain scheduled
  blocks sized to task estimate between 10 AM and 10 PM `America/Denver`,
  confirm a suitable block on that day or sooner, or propose the next start.
  No booking or calendar operations occur.
- Mixed M.A.B.+service: both separate sections in one email.
- Unrecognized products: not fulfilled by this router.

Order fields are held in `db.shopify_fulfillments`, uniquely indexed by
(shop_domain, order_id): order ID, customer email, product type, service names,
service estimated durations or "to be confirmed" when missing, service desired
dates or null, timezone, send status, retry attempts, provider message ID, and
sent sections. **No plaintext activation code or OAuth secret goes in logs or
the fulfillment collection.** The order-bound encrypted activation code is
still stored only in `db.activation_codes`.

This is an at-least-once email delivery path: atomic pending/sending/delivered
claims suppress normal webhook duplicates; unacknowledged provider sends may be
retried if the process dies between Gmail acceptance and database recording.
Gmail provider message ID is logged for successful sends.

## Sender: S&K Gmail API over HTTPS

No SMTP connection is used for new paid-order webhook delivery. Gmail API
`users.messages.send` uses HTTPS and the account's business sender identity.
The authorized Gmail account must own `MAB_LICENSE_FROM_EMAIL` or have that
address configured as a Gmail "Send mail as" alias.

Render environment requirements (server-side ONLY):

- `SHOPIFY_WEBHOOK_SECRET`: verified Shopify webhook signing secret
- `SHOPIFY_SHOP_DOMAIN`: stable internal identity
  `vd1k2v-ew.myshopify.com` (not the separately branded storefront domain)
- `MAB_ACTIVATION_ENCRYPTION_KEY`: the EXISTING Fernet key, never rotate casually
- `MAB_LICENSE_FROM_EMAIL`: existing authorized business sender mailbox
- `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`,
  `GMAIL_OAUTH_REFRESH_TOKEN`: credentials created through Google Cloud OAuth
  for this business account with the minimum `gmail.send` authorization
- Existing `MONGO_URL`, `DB_NAME`, and authentication settings unchanged

Do not commit, screenshot, or paste real OAuth secrets into project files or
chat messages. Google OAuth must be configured before switching this branch
live. The pre-existing `MAB_LICENSE_SMTP_*` settings can remain configured but
are no longer read by the new sender.

## Safe rollout and recovery

1. Run isolated backend tests, including
   `pytest -q tests/test_activation_codes.py`.
2. Authorize the existing S&K business mailbox using Google OAuth, keeping
   refresh token server-side on Render only.
3. Merge backend changes onto `shared-product-access`; Render redeploys.
4. Retry the previously failed Shopify test order **#1004** webhook first.
   Its order-bound activation code was already issued before SMTP failed.
   The new route reuses that same code, never mints a second one.
5. Confirm message in S&K Sent and buyer inbox, redeem code once in M.A.B.,
   and confirm `mab_s1` entitlement.
6. Exercise service-only and mixed-order routes using Shopify test mode, without
   adding any scheduling/calendar integration yet.
7. Turn Shopify Payments test mode OFF after the coordinated test session.

The delivery audit's status is independent from Shopify fulfillment-status
badges. Code activation never creates a booking or a calendar event.
