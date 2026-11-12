"""Exact Shopify SVG Micro Eco lifetime-product recognition and secure license codes.

The merchant's paid order webhook is the only issuer. A buyer must redeem a
cryptographically random SVG1 code while signed into the SVG Micro Eco hub.
This module does not alter M.A.B. activation or Stripe fulfillment.
"""
from datetime import datetime, timezone
from secrets import token_hex
import re

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from activation_codes import decrypt_delivery_code, encrypt_delivery_code, hash_activation_code

# Product AND variant must match, never title or SKU alone.
SVG_SHOPIFY_PRODUCTS = {
    ("15476020576535", "68167230914839"): ("PathSeal", ["pathseal"]),
    ("15476021133591", "68167231668503"): ("Duplicate Line Remover", ["duplicate_geometry"]),
    ("15476021264663", "68167231799575"): ("Stray Node Cleaner", ["stray_node_cleaner"]),
    ("15476021395735", "68167231930647"): ("Overlapping Shape Repair", ["overlapping_shape_repair"]),
    ("15476021526807", "68167232061719"): ("Curve Repair", ["curve_repair"]),
    ("15476021592343", "68167232127255"): (
        "Complete Five-Tool Bundle",
        ["pathseal", "duplicate_geometry", "stray_node_cleaner",
         "overlapping_shape_repair", "curve_repair"],
    ),
}
SVG_CODE_PATTERN = re.compile(r"^SVG1-[0-9A-F]{32}$")


def svg_order_licenses(order: dict) -> list[dict]:
    """Snapshot exact matching product/variant pairs and quantities from a paid order."""
    items = order.get("line_items")
    if not isinstance(items, list):
        raise ValueError("Invalid Shopify line items.")
    result = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Invalid Shopify line item.")
        product = str(item.get("product_id") or "")
        variant = str(item.get("variant_id") or "")
        definition = SVG_SHOPIFY_PRODUCTS.get((product, variant))
        if definition is None:
            continue
        quantity = item.get("quantity")
        if type(quantity) is not int or not 1 <= quantity <= 100:
            raise ValueError("Invalid SVG license quantity.")
        name, grants = definition
        result.append({
            "product_id": product, "variant_id": variant, "name": name,
            "quantity": quantity, "entitlements": list(grants),
        })
    return result


def svg_license_key(shop: str, order_id: str, product: str, variant: str, unit: int) -> str:
    if not shop or not str(order_id).isdigit() or not 1 <= unit <= 100:
        raise ValueError("Invalid Shopify SVG license identity.")
    if (product, variant) not in SVG_SHOPIFY_PRODUCTS:
        raise ValueError("Unknown Shopify SVG product.")
    return f"{shop.strip().lower()}:{order_id}:svg:{product}:{variant}:{unit}"


def validate_svg_code(code: str) -> bool:
    return isinstance(code, str) and SVG_CODE_PATTERN.fullmatch(code.strip().upper()) is not None


async def issue_svg_license(collection, shop, order_id, line, unit, email):
    """Issue/recover one encrypted code per verified order/variant/unit."""
    if (str(line.get("product_id")), str(line.get("variant_id"))) not in SVG_SHOPIFY_PRODUCTS:
        raise ValueError("Unknown Shopify SVG product.")
    key = svg_license_key(shop, str(order_id), str(line["product_id"]), str(line["variant_id"]), unit)
    grants = SVG_SHOPIFY_PRODUCTS[(str(line["product_id"]), str(line["variant_id"]))][1]
    existing = await collection.find_one({"shopify_license_key": key})
    if existing:
        if (existing.get("delivery_email") != email or
                existing.get("entitlement_ids") != grants or
                not existing.get("encrypted_delivery_code")):
            raise RuntimeError("Existing Shopify SVG license needs manual review.")
        return decrypt_delivery_code(existing["encrypted_delivery_code"])

    code = "SVG1-" + token_hex(16).upper()
    document = {
        "code_hash": hash_activation_code(code),
        "encrypted_delivery_code": encrypt_delivery_code(code),
        "product_id": "svg_micro_eco_lifetime",
        "license_type": "svg_lifetime",
        "entitlement_ids": grants,
        "shopify_license_key": key,
        "shopify_order_id": str(order_id),
        "shop_domain": shop.strip().lower(),
        "delivery_email": email,
        "delivery_status": "pending",
        "delivery_attempts": 0,
        "status": "issued",
        "entitlement_status": "pending",
        "redeemed_by": None,
        "issued_at": datetime.now(timezone.utc),
    }
    try:
        await collection.insert_one(document)
    except DuplicateKeyError:
        existing = await collection.find_one({"shopify_license_key": key})
        if not existing or existing.get("delivery_email") != email or existing.get("entitlement_ids") != grants:
            raise RuntimeError("Concurrent Shopify SVG license needs manual review.")
        return decrypt_delivery_code(existing["encrypted_delivery_code"])
    return code


async def redeem_svg_code(collection, code: str, user_id: str):
    """One-time atomic claim. A held/previously used code cannot move owners."""
    if not validate_svg_code(code):
        return None
    code_hash = hash_activation_code(code)
    return await collection.find_one_and_update(
        {"code_hash": code_hash, "product_id": "svg_micro_eco_lifetime",
         "license_type": "svg_lifetime", "status": "issued",
         "redeemed_by": None, "entitlement_status": "pending",
         "commerce_review_required": {"$ne": True}},
        {"$set": {"status": "redeemed", "redeemed_by": user_id,
                  "redeemed_at": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )


async def get_svg_redemption_for_user(collection, code: str, user_id: str):
    if not validate_svg_code(code):
        return None
    return await collection.find_one({
        "code_hash": hash_activation_code(code),
        "product_id": "svg_micro_eco_lifetime",
        "license_type": "svg_lifetime", "status": "redeemed",
        "redeemed_by": user_id,
        "entitlement_status": {"$in": ["pending", "complete"]},
    })
