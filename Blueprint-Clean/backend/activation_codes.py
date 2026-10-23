
import hashlib
import secrets

LICENSE_PRODUCT = "mab_s1"
LICENSE_TYPE = "one_time_s1"
CODE_PREFIX = "MAB1"


def generate_activation_code() -> str:
    """Generate a cryptographically random activation code."""
    token = secrets.token_hex(16).upper()
    return f"{CODE_PREFIX}-{token}"


def hash_activation_code(code: str) -> str:
    """Hash the code before storing it in the database."""
    normalized = code.strip().upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


import re

CODE_PATTERN = re.compile(r"^MAB1-[0-9A-F]{32}$")


def validate_activation_code(code: str) -> bool:
    """Check activation-code format without exposing stored codes."""
    if not isinstance(code, str):
        return False

    return CODE_PATTERN.fullmatch(code.strip().upper()) is not None


from datetime import datetime, timezone
from pymongo import ReturnDocument


async def redeem_activation_code(collection, code: str, user_id: str):
    """Atomically redeem an unused activation code for one user."""
    if not validate_activation_code(code):
        return None

    code_hash = hash_activation_code(code)

    return await collection.find_one_and_update(
        {
            "code_hash": code_hash,
           "status": "issued",
            "product_id": LICENSE_PRODUCT,
            "redeemed_by": None,
            "entitlement_status": "pending",
        },
        {
            "$set": {
                "status": "redeemed",
                "redeemed_by": user_id,
                "redeemed_at": datetime.now(timezone.utc),
            }
        },
        return_document=ReturnDocument.AFTER,
    )


async def ensure_activation_indexes(collection):
    """Prevent duplicate activation codes and Shopify order issuance."""
    await collection.create_index(
        "code_hash",
        unique=True,
        name="unique_activation_code",
    )

    await collection.create_index(
        "shopify_order_id",
        unique=True,
        partialFilterExpression={
            "shopify_order_id": {"$type": "string"}
        },
        name="unique_shopify_order",
    )


async def mark_activation_complete(collection, code_hash: str, user_id: str):
    """Mark redemption complete after the account license is granted."""
    result = await collection.update_one(
        {
            "code_hash": code_hash,
            "status": "redeemed",
            "redeemed_by": user_id,
        },
        {
            "$set": {
                "entitlement_status": "complete",
                "status": "redeemed",
            }
        },
    )
    return result.matched_count == 1



async def get_pending_redemption(collection, code: str, user_id: str):
    """Find a previously redeemed code belonging to this user.

    Supports retrying interrupted grants and checking completed licenses.
    """
    if not validate_activation_code(code):
        return None

    return await collection.find_one({
        "code_hash": hash_activation_code(code),
        "product_id": LICENSE_PRODUCT,
        "status": "redeemed",
        "redeemed_by": user_id,
        "entitlement_status": {"$in": ["pending", "complete"]},
    })

