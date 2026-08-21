from decimal import Decimal, ROUND_HALF_UP

from subscription_policy import pathseal_access_action


SVG_TOOL_MONTHLY_CENTS = 999

SVG_TOOL_CATALOG = {
    "pathseal": {
        "name": "PathSeal",
        "available": True,
    },
    "duplicate_geometry": {
        "name": "Duplicate Line Remover",
        "available": True,
    },
    "stray_node_cleaner": {
        "name": "Stray Node Cleaner",
        "available": False,
    },
    "overlapping_shape_repair": {
        "name": "Overlapping Shape Repair",
        "available": False,
    },
    "curve_repair": {
        "name": "Curve Repair",
        "available": False,
    },
}

SVG_MULTI_TOOL_DISCOUNT_PERCENT = {
    1: 0,
    2: 5,
    3: 10,
    4: 15,
    5: 20,
}

SVG_TOOL_PRICE_ENV = {
    "pathseal": "STRIPE_PRICE_PATHSEAL_MONTHLY",
    "duplicate_geometry": "STRIPE_PRICE_DUPLICATE_GEOMETRY_MONTHLY",
    "stray_node_cleaner": "STRIPE_PRICE_STRAY_NODE_CLEANER_MONTHLY",
    "overlapping_shape_repair": "STRIPE_PRICE_OVERLAPPING_SHAPE_REPAIR_MONTHLY",
    "curve_repair": "STRIPE_PRICE_CURVE_REPAIR_MONTHLY",
}

SVG_DISCOUNT_COUPON_ENV = {
    2: "STRIPE_COUPON_SVG_TWO_TOOLS",
    3: "STRIPE_COUPON_SVG_THREE_TOOLS",
    4: "STRIPE_COUPON_SVG_FOUR_TOOLS",
    5: "STRIPE_COUPON_SVG_FIVE_TOOLS",
}


class SvgSubscriptionSelectionError(ValueError):
    pass


def quote_svg_subscription(selected_product_ids: list[str]) -> dict:
    unique_product_ids = list(dict.fromkeys(selected_product_ids))

    if not unique_product_ids:
        raise SvgSubscriptionSelectionError(
            "Select at least one SVG Micro Eco tool."
        )

    if len(unique_product_ids) != len(selected_product_ids):
        raise SvgSubscriptionSelectionError(
            "Each SVG Micro Eco tool may be selected only once."
        )

    unknown_product_ids = [
        product_id
        for product_id in unique_product_ids
        if product_id not in SVG_TOOL_CATALOG
    ]
    if unknown_product_ids:
        raise SvgSubscriptionSelectionError(
            "Unknown SVG Micro Eco tool selection."
        )

    unavailable_product_ids = [
        product_id
        for product_id in unique_product_ids
        if not SVG_TOOL_CATALOG[product_id]["available"]
    ]
    if unavailable_product_ids:
        raise SvgSubscriptionSelectionError(
            "One or more selected SVG Micro Eco tools are not available yet."
        )

    tool_count = len(unique_product_ids)
    subtotal_cents = SVG_TOOL_MONTHLY_CENTS * tool_count
    discount_percent = SVG_MULTI_TOOL_DISCOUNT_PERCENT[tool_count]
    discount_cents = int(
        (
            Decimal(subtotal_cents)
            * Decimal(discount_percent)
            / Decimal(100)
        ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    total_cents = subtotal_cents - discount_cents

    return {
        "currency": "usd",
        "interval": "month",
        "selected_product_ids": unique_product_ids,
        "tool_count": tool_count,
        "unit_amount_cents": SVG_TOOL_MONTHLY_CENTS,
        "subtotal_cents": subtotal_cents,
        "discount_percent": discount_percent,
        "discount_cents": discount_cents,
        "total_cents": total_cents,
        "line_items": [
            {
                "product_id": product_id,
                "name": SVG_TOOL_CATALOG[product_id]["name"],
                "unit_amount_cents": SVG_TOOL_MONTHLY_CENTS,
            }
            for product_id in unique_product_ids
        ],
    }


def build_svg_checkout_plan(
    selected_product_ids: list[str],
    configuration: dict[str, str],
) -> dict:
    """Build a Stripe Checkout plan without calling Stripe or changing state."""
    quote = quote_svg_subscription(selected_product_ids)
    missing_configuration = []
    line_items = []

    for product_id in quote["selected_product_ids"]:
        environment_name = SVG_TOOL_PRICE_ENV[product_id]
        price_id = configuration.get(environment_name, "").strip()

        if not price_id:
            missing_configuration.append(environment_name)
            continue

        line_items.append(
            {
                "price": price_id,
                "quantity": 1,
            }
        )

    coupon_id = ""
    coupon_environment_name = SVG_DISCOUNT_COUPON_ENV.get(
        quote["tool_count"]
    )
    if coupon_environment_name:
        coupon_id = configuration.get(
            coupon_environment_name,
            "",
        ).strip()
        if not coupon_id:
            missing_configuration.append(coupon_environment_name)

    if missing_configuration:
        raise SvgSubscriptionSelectionError(
            "SVG subscription checkout is not configured."
        )

    metadata = {
        "package_id": "svg_micro_eco_selection",
        "billing_mode": "subscription",
        "selected_product_ids": ",".join(
            quote["selected_product_ids"]
        ),
        "tool_count": str(quote["tool_count"]),
        "discount_percent": str(quote["discount_percent"]),
    }

    return {
        "quote": quote,
        "line_items": line_items,
        "discounts": (
            [{"coupon": coupon_id}]
            if coupon_id
            else []
        ),
        "metadata": metadata,
    }


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
