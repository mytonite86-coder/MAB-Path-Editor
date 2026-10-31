# SVG Micro Eco selectable subscription foundation

## Block 33 controlled deployment preparation - 2026-10-30

Release branch `release/block33-shared-backend` starts from freshly fetched
`shared-product-access` at `e70ed0e9ea7b7cf9c534d5f64434dd2b8a89fcbb`.
Only `Blueprint-Clean/backend` changes from reviewed `3da09a6` are included;
no SVG frontend publication, MAB frontend build input, new infrastructure,
catalog change, data migration or purchase activation is included.

Read-only Render verification confirms rollback source
`4b0f3f2df51454f2c4ffd54443507668140d092d`, Live deployment
`dep-dbfc0uk9v7es73dagt40` on existing service `srv-d9a9us7avr4c73aqtusg`.
Current branch backend tree is identical to that live rollback source; newer
repository frontend work at `e70ed0e` is preserved. Release promotion must use
normal branch protection and required Public production boundaries checks.

Preflight production `/api/health` reports healthy; `/api/ready` reports ready,
configuration ready with no missing names, and MongoDB ready. Public package
API confirms existing MAB S1.5 USD $30 one-time offer. Render configuration-name
inspection confirms Stripe signing/API, Mongo/auth, Shopify activation/encryption
and Gmail fulfillment settings exist without reading secret values. The SVG
checkout switch and integration label are absent; checkout defaults OFF. The
release retains that fail-closed gate and requires no environment changes.

The prior 35 focused checks are retained because runtime backend content is
identical to Block 32. Whitespace and backend-only diff checks passed. Post-deploy
health/readiness and anonymous auth/activation/signature boundaries must be
verified against the intended Render commit before recording this block complete.
No live charges, test purchases, activation redemption or customer writes are
permitted for that smoke check. Purchasing must remain disabled afterward.

## Block 32 M.A.B. mapping repair - 2026-10-30

The Block 31 inherited Stripe mapping blocker is now resolved locally on
`work/block32-mab-entitlement-mapping`, based on `a005c85`. Current `mab_s1.5`
and legitimate legacy `mab_s1` one-time purchases explicitly grant existing
`mab_s1`, never S2 or unrelated access. Payment dispatcher and fulfillment helper
use the same map; ownership mismatch and failed event denial remain fail-closed.
Permanent S1 grants survive legacy subscription cancellation. MAB checkout
pricing/catalog/activation and SVG lifetime handlers/Prices are unchanged.

The former strict expected failure is now passing with no marker. 35 distinct
focused checks pass (14 mapping, 6 shared, 15 SVG); no outstanding failures.
README and the existing launch checklist contain validation and release handoff.
No production/customer records were modified and SVG purchases remain disabled.
Locally software-release-ready; real delivery, existing safeguards and separately
authorized production release remain required. STOP after local commit.

## Block 31 shared release reconciliation - 2026-10-30

**Local reconciliation complete; production release BLOCKED.** Verified starting
SVG patch `589414c`; branch `work/block31-shared-backend-reconciliation` is based
on current shared branch head `e70ed0e9ea7b7cf9c534d5f64434dd2b8a89fcbb`, with
only applicable SVG changes transposed. The prior Block 30 branch remains intact.
No Git merge, push, deployment, activation or production data change occurred.
Frontend companion: `work/block31-backend-release-checkpoint`, base `f68fb3d`.

### Confirmed live revision

Render's authenticated read-only service/deploy view confirmed service
`srv-d9a9us7avr4c73aqtusg`, Live deployment `dep-dbfc0uk9v7es73dagt40`, commit
`4b0f3f2df51454f2c4ffd54443507668140d092d`. The current protected
`shared-product-access` branch is `e70ed0e9ea7b7cf9c534d5f64434dd2b8a89fcbb`;
its `Blueprint-Clean/backend` tree is identical to the deployed commit. Thus the
reconciliation preserves current repository updates without guessing the live
revision from branch HEAD. Existing Render service/root/build/start architecture
is reused. No environment secret or customer record was opened.

### Reconciliation boundary

Current MAB $30 one-time `mab_s1_payment` package and `mab_s1.5` metadata, legacy
Stripe API calls, return destinations, authentication, licensing/activation,
Shopify/Gmail fulfillment, subscription policy, dependency file and startup
uniqueness indexes are preserved. Tests compare the protected functions/modules
against the actual deployed source. Current MAB code was not replaced by the
older $7.99 monthly backend from which the SVG work began.

SVG's six exact Price mappings, quote/payment-mode route, lifetime markers,
signature-gated fulfillment, owner/amount/currency validation, idempotency and
legacy SVG cancellation protection are retained. The SVG route alone uses an
explicit StripeClient; the current MAB checkout/status/subscription SDK call sites
are untouched. Stripe metadata conversion supports current SDK objects. Signature
verification does not require the API key before dispatch; downstream legacy
MAB API calls retain their existing key requirements. The single shared signed
Stripe endpoint routes both payment families to their existing package-specific
handlers; Shopify signatures/routes and activation code behavior are unchanged.
Frontend runtime/repair code is unchanged; no browser/repair suites repeated.

### Focused evidence and inherited blocker

29 focused checks passed: 26 shared release/SVG purchase/signature checks plus
3 selected deployed activation/Shopify checks. Covers all six lifetime Prices,
individual/bundle grants without unrelated access, ownership/replay/paid-state
checks, current MAB package equality/configuration, exact payment-handler tail
preservation, protected authentication/licensing modules, signed dispatch for
both families and code redemption/duplicate-safe licensing. Syntax and whitespace
checks passed. Existing test environment lacked `cryptography`; the already
bundled installed package was added to the test process search path, with no
install or persistent environment change. No customer/service writes or real
payment calls were made.

**One confirmed pre-existing MAB Stripe fulfillment blocker remains.** The live
package's metadata is `product_id=mab_s1.5`, but the existing one-time fulfillment
condition checks only `product_id == "mab_s1"`. An isolated paid/complete $30
fixture therefore returns True with no entitlement and `is_premium=False`.
AST comparison proves the MAB handler tail is identical to deployed source, so
this is inherited rather than introduced by SVG integration. Shopify activation
passes; this evidence does not claim those separate paths are broken.
`test_inherited_mab_s15_paid_checkout_requires_entitlement` records the required
result as a strict expected failure (1 XFAIL), explicitly a release blocker,
not a passed payment acceptance. No MAB correction was made under the instruction
to preserve current payment/entitlement behavior. A targeted owner-authorized
identifier correction is needed before release consideration.

Next release action: HOLD deployment; authorize/fix that specific MAB Stripe
fulfillment mapping and require its regression to pass before separately
reviewing/publishing these companion commits. Real isolated Stripe delivery,
existing recovery/access safeguards and separate deployment authorization remain
required; purchasing stays OFF. The old isolated SVG branch must not be deployed
as a replacement for the current shared backend. STOP after local commits.

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
