from decimal import Decimal, ROUND_HALF_UP


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
