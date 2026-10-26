"""Classify verified Shopify paid orders for S&K fulfillment.

Never trust the product title alone to determine an entitlement. M.A.B. uses
an exact product+variant pair, and services use catalog product IDs/SKUs.
"""
from activation_codes import SHOPIFY_MAB_PRODUCT_ID, SHOPIFY_MAB_VARIANT_ID

TIMEZONE = "America/Denver"

# Existing published S&K fixed-scope services; more can use SK-SVC- SKUs.
SERVICE_PRODUCT_IDS = frozenset({
    "15444231258391", "15444231422231", "15444231848215",
    "15444231946519", "15444235649303", "15444361838871",
    "15444361937175", "15444362363159", "15444362494231",
    "15444362625303", "15444362690839", "15444362789143",
})


def _properties(item):
    raw = item.get("properties") or []
    if isinstance(raw, dict):
        return {str(k).strip().lower(): str(v).strip() for k, v in raw.items() if v}
    if not isinstance(raw, list):
        return {}
    return {
        str(prop.get("name") or "").strip().lower():
        str(prop.get("value") or "").strip()
        for prop in raw if isinstance(prop, dict) and prop.get("value")
    }


def _custom_value(item, *keys):
    props = _properties(item)
    for key in keys:
        if props.get(key):
            return props[key][:160]
    return None


def build_fulfillment_route(order: dict) -> dict:
    """Return a code, service, mixed, or ignored route without issuing codes."""
    items = order.get("line_items")
    if not isinstance(items, list):
        raise ValueError("Invalid Shopify line items.")

    license_count = 0
    services = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Invalid Shopify line item.")
        product_id = str(item.get("product_id") or "")
        variant_id = str(item.get("variant_id") or "")
        sku = str(item.get("sku") or "").strip().upper()
        is_mab = (
            product_id == SHOPIFY_MAB_PRODUCT_ID
            and variant_id == SHOPIFY_MAB_VARIANT_ID
        )
        is_service = (
            not is_mab
            and (product_id in SERVICE_PRODUCT_IDS or sku.startswith("SK-SVC-"))
        )
        if not (is_mab or is_service):
            continue
        qty = item.get("quantity")
        if type(qty) is not int or qty < 1:
            raise ValueError("Invalid Shopify fulfillment quantity.")
        if is_mab:
            license_count += qty
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            raise ValueError("Service name is required.")
        duration = _custom_value(
            item, "estimated duration", "estimated_duration", "duration"
        )
        date = _custom_value(
            item, "desired date", "desired_date", "requested date",
            "due date", "due_date", "deadline"
        )
        services.append({
            "product_type": "service",
            "product_id": product_id,
            "service_name": title[:160],
            "quantity": qty,
            "estimated_duration": duration,
            "desired_date": date,
            "timezone": TIMEZONE,
        })

    category = (
        "mixed" if license_count and services
        else "mab_s1" if license_count
        else "service" if services
        else "ignored"
    )
    return {
        "product_type": category,
        "mab_license_quantity": license_count,
        "services": services,
        "timezone": TIMEZONE,
    }
