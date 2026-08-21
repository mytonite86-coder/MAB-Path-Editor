# SVG Micro Eco selectable subscription foundation

The approved commercial contract keeps every SVG Micro Eco tool at a $9.99
monthly list price and applies a separate discount to the combined subtotal:
0%, 5%, 10%, 15%, and 20% for one through five active paid tools.

`POST /api/payments/svg-subscription/quote` is a calculation-only boundary. It
accepts stable product IDs and returns line items, subtotal, discount, and the
approved pre-tax total in integer cents. It does not create a Stripe Checkout
Session, modify a subscription, grant an entitlement, or write to MongoDB.

Only tools marked available in `svg_subscription.py` may be quoted. The full
five-tool ladder is tested in isolation so planned tools can be activated
without changing pricing arithmetic.

Before production checkout is added:

1. Create separate recurring Stripe Prices for each tool at $9.99/month in an
   isolated Stripe test environment.
2. Represent selected tools as separate subscription line items.
3. Apply the approved count-based discount to the subscription subtotal.
4. Store stable product IDs in subscription metadata and reconcile them from
   verified webhook events.
5. Add and remove only the corresponding entitlements; preserve
   `all_products_lifetime` and existing PathSeal founder access.
6. Show proration, taxes, selected line items, discount, and final total before
   the customer confirms a subscription change.
7. Use Stripe Billing with Checkout Sessions, omit `payment_method_types`, and
   add an `integration_identifier` on the current Stripe API version.
8. Do not enable automatic tax until registrations are confirmed.

## Checkout configuration boundary

`build_svg_checkout_plan` prepares—but does not submit—the Stripe Checkout
line items, count-based coupon, and bounded subscription metadata. It fails
closed when any required identifier is absent.

Required configuration names for currently available tools:

- `STRIPE_PRICE_PATHSEAL_MONTHLY`
- `STRIPE_PRICE_DUPLICATE_GEOMETRY_MONTHLY`
- `STRIPE_COUPON_SVG_TWO_TOOLS`

Future tool Price and discount Coupon configuration names already exist in the
policy module but are not required until those tools become available. Values
must come from an isolated Stripe test environment first and must never be
committed. Checkout must remain disconnected until webhook-driven entitlement
reconciliation is implemented and tested for each selected product ID.

`parse_svg_product_ids` rejects duplicate or unknown metadata values.
`plan_svg_entitlement_transition` defines the fail-closed webhook policy:
active subscriptions grant the current selection and revoke removed
selections; canceled subscription states revoke the complete selection;
incomplete or unknown states hold existing access unchanged. These functions
perform no database writes and provide the tested contract for the next
integration step.
