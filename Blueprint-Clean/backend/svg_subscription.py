from subscription_policy import pathseal_access_action

SVG_BUNDLE_ID = "svg_complete_bundle"
SVG_TOOL_CATALOG = {
    "pathseal": {"name": "PathSeal", "available": True},
    "duplicate_geometry": {"name": "Duplicate Line Remover", "available": True},
    "stray_node_cleaner": {"name": "Stray Node Cleaner", "available": True},
    "overlapping_shape_repair": {"name": "Overlapping Shape Repair", "available": True},
    "curve_repair": {"name": "Curve Repair", "available": True},
}
SVG_PRICE_IDS = dict(zip([*SVG_TOOL_CATALOG, SVG_BUNDLE_ID], [
    "price_1UWR05GcjYPS3asvfYYyOfNb", "price_1UWR0DGcjYPS3asvaIMuvUjo",
    "price_1UWR0EGcjYPS3asvvzGDU6eH", "price_1UWR0GGcjYPS3asvGXEkZ9LB",
    "price_1UWR0IGcjYPS3asvPdIxw729", "price_1UWR0KGcjYPS3asvWLg8MvVb",
]))
SVG_TOOL_PRICE_ENV = {pid: "STRIPE_PRICE_" + pid.upper() + "_LIFETIME" for pid in SVG_PRICE_IDS}
# Kept empty for import compatibility; no recurring coupon participates in checkout.
SVG_DISCOUNT_COUPON_ENV = {}

class SvgSubscriptionSelectionError(ValueError):
    pass

def quote_svg_subscription(selected_product_ids: list[str]) -> dict:
    if not selected_product_ids or len(set(selected_product_ids)) != len(selected_product_ids):
        raise SvgSubscriptionSelectionError("Select each available SVG purchase only once.")
    if any(pid not in SVG_PRICE_IDS for pid in selected_product_ids):
        raise SvgSubscriptionSelectionError("Unknown SVG purchase selection.")
    if SVG_BUNDLE_ID in selected_product_ids and len(selected_product_ids) != 1:
        raise SvgSubscriptionSelectionError("The complete bundle cannot be combined with individual tools.")
    bundle = selected_product_ids == [SVG_BUNDLE_ID] or set(selected_product_ids) == set(SVG_TOOL_CATALOG)
    entitlements = list(SVG_TOOL_CATALOG) if bundle else list(selected_product_ids)
    items = [{"product_id": SVG_BUNDLE_ID, "name": "Complete Five-Tool Bundle", "unit_amount_cents": 3499}] if bundle else [
        {"product_id": pid, "name": SVG_TOOL_CATALOG[pid]["name"], "unit_amount_cents": 999} for pid in selected_product_ids
    ]
    total = sum(item["unit_amount_cents"] for item in items)
    return {"currency": "usd", "interval": "lifetime", "selected_product_ids": entitlements,
        "tool_count": len(entitlements), "unit_amount_cents": 3499 if bundle else 999,
        "subtotal_cents": total, "discount_percent": 0, "discount_cents": 0,
        "total_cents": total, "line_items": items}

def build_svg_checkout_plan(selected_product_ids: list[str], configuration: dict[str, str]) -> dict:
    quote = quote_svg_subscription(selected_product_ids)
    line_items = []
    for item in quote["line_items"]:
        pid = item["product_id"]
        price = configuration.get(SVG_TOOL_PRICE_ENV[pid], SVG_PRICE_IDS[pid]).strip()
        if not price:
            raise SvgSubscriptionSelectionError("SVG lifetime checkout is not configured.")
        line_items.append({"price": price, "quantity": 1})
    return {"quote": quote, "line_items": line_items, "discounts": [], "metadata": {
        "package_id": "svg_micro_eco_lifetime", "billing_mode": "payment",
        "selected_product_ids": ",".join(quote["selected_product_ids"]),
        "purchase_product_ids": ",".join(item["product_id"] for item in quote["line_items"]),
    }}

def build_svg_checkout_session_parameters(plan, user_id, user_email, success_url, cancel_url, integration_identifier):
    return {"mode": "payment", "line_items": plan["line_items"], "success_url": success_url,
        "cancel_url": cancel_url, "client_reference_id": user_id, "customer_email": user_email,
        "metadata": {**plan["metadata"], "user_id": user_id, "user_email": user_email},
        "integration_identifier": integration_identifier}

def parse_svg_product_ids(value: str | None) -> list[str]:
    if not value:
        return []

    product_ids = [
        product_id.strip()
        for product_id in value.split(",")
        if product_id.strip()
    ]

    if len(product_ids) != len(set(product_ids)):
        raise SvgSubscriptionSelectionError(
            "Subscription metadata contains duplicate SVG tools."
        )

    if any(product_id not in SVG_TOOL_CATALOG for product_id in product_ids):
        raise SvgSubscriptionSelectionError(
            "Subscription metadata contains an unknown SVG tool."
        )

    return product_ids


def plan_svg_entitlement_transition(
    previous_product_ids: list[str],
    current_product_ids: list[str],
    subscription_status: str,
) -> dict[str, list[str] | str]:
    """Return entitlement changes; callers remain responsible for safe writes."""
    action = pathseal_access_action(subscription_status)
    previous = set(previous_product_ids)
    current = set(current_product_ids)

    if action == "grant":
        grant = sorted(current)
        revoke = sorted(previous - current)
    elif action == "revoke":
        grant = []
        revoke = sorted(previous | current)
    else:
        grant = []
        revoke = []

    return {
        "action": action,
        "grant": grant,
        "revoke": revoke,
    }
