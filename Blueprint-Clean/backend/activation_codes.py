
import base64
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


def encrypt_delivery_code(code: str) -> str:
    """Encrypt an activation code for recoverable delivery."""
    key = os.environ.get("MAB_ACTIVATION_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("Activation encryption key is not configured.")
    return Fernet(key.encode()).encrypt(code.encode()).decode()


def decrypt_delivery_code(encrypted: str) -> str:
    """Recover an issued code for authorized delivery retries."""
    key = os.environ.get("MAB_ACTIVATION_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError("Activation encryption key is not configured.")
    try:
        return Fernet(key.encode()).decrypt(encrypted.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Activation code cannot be decrypted.") from exc


LICENSE_PRODUCT = "mab_s1"
LICENSE_TYPE = "one_time_s1"
CODE_PREFIX = "MAB1"

SHOPIFY_MAB_PRODUCT_ID = "15428412571927"
SHOPIFY_MAB_VARIANT_ID = "67773605544215"


def generate_activation_code() -> str:
    """Generate a cryptographically random activation code."""
    token = secrets.token_hex(16).upper()
    return f"{CODE_PREFIX}-{token}"


def hash_activation_code(code: str) -> str:
    """Hash the code before storing it in the database."""
    normalized = code.strip().upper()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


CODE_PATTERN = re.compile(r"^MAB1-[0-9A-F]{32}$")


def validate_activation_code(code: str) -> bool:
    """Check activation-code format without exposing stored codes."""
    if not isinstance(code, str):
        return False

    return CODE_PATTERN.fullmatch(code.strip().upper()) is not None


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
        "shopify_license_key",
        unique=True,
        partialFilterExpression={
            "shopify_license_key": {"$type": "string"}
        },
        name="unique_shopify_license",
    )


async def ensure_shopify_order_state_indexes(collection):
    """Ensure one durable cancellation/refund state per Shopify order."""
    await collection.create_index(
        [("shop_domain", 1), ("order_id", 1)],
        unique=True,
        name="unique_shopify_order_state",
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


def shopify_license_key(shop_domain: str, order_id: str, unit: int = 1) -> str:
    """Identify one license unit within a Shopify order."""
    if not shop_domain or not order_id or unit < 1:
        raise ValueError("Invalid Shopify order identity.")

    return f"{shop_domain.strip().lower()}:{order_id.strip()}:{unit}"


async def issue_shopify_activation_code(
    collection,
    shop_domain: str,
    order_id: str,
    unit: int = 1,
    delivery_email: str | None = None,
):
    """Issue or recover one code for a verified paid Shopify order unit.

    Caller must verify Shopify payment and order details first.
    """
    license_key = shopify_license_key(shop_domain, order_id, unit)

    existing = await collection.find_one({
        "shopify_license_key": license_key
    })

    if existing:
        existing_email = existing.get("delivery_email")
        if delivery_email and existing_email and existing_email != delivery_email:
            raise RuntimeError(
                "Shopify order email changed. Manual review required."
            )
        encrypted = existing.get("encrypted_delivery_code")
        if not encrypted:
            raise RuntimeError(
                "Existing activation cannot be recovered. Manual review required."
            )
        return {
            "created": False,
            "code": decrypt_delivery_code(encrypted),
        }

    code = generate_activation_code()
    encrypted = encrypt_delivery_code(code)

    try:
        await collection.insert_one({
            "code_hash": hash_activation_code(code),
            "encrypted_delivery_code": encrypted,
            "product_id": LICENSE_PRODUCT,
            "license_type": LICENSE_TYPE,
            "shopify_license_key": license_key,
            "shopify_order_id": str(order_id),
            "shop_domain": shop_domain.strip().lower(),
            "delivery_email": delivery_email,
            "delivery_status": "pending",
            "delivery_attempts": 0,
            "status": "issued",
            "entitlement_status": "pending",
            "redeemed_by": None,
            "issued_at": datetime.now(timezone.utc),
        })
    except DuplicateKeyError:
        existing = await collection.find_one({
            "shopify_license_key": license_key
        })
        if not existing or not existing.get("encrypted_delivery_code"):
            raise RuntimeError(
                "Concurrent issuance could not be recovered."
            )
        existing_email = existing.get("delivery_email")
        if delivery_email and existing_email and existing_email != delivery_email:
            raise RuntimeError(
                "Shopify order email changed. Manual review required."
            )
        return {
            "created": False,
            "code": decrypt_delivery_code(
                existing["encrypted_delivery_code"]
            ),
        }

    return {"created": True, "code": code}


DELIVERY_CLAIM_TIMEOUT = timedelta(minutes=10)


async def claim_shopify_activation_delivery(collection, license_key: str):
    """Atomically claim an undelivered code for one delivery attempt."""
    now = datetime.now(timezone.utc)
    stale_before = now - DELIVERY_CLAIM_TIMEOUT
    return await collection.find_one_and_update(
        {
            "shopify_license_key": license_key,
            "$or": [
                {"delivery_status": {"$in": ["pending", "failed"]}},
                {"delivery_status": {"$exists": False}},
                {
                    "delivery_status": "sending",
                    "delivery_claimed_at": {"$lt": stale_before},
                },
            ],
        },
        {
            "$set": {
                "delivery_status": "sending",
                "delivery_claimed_at": now,
            },
            "$unset": {"delivery_last_error": ""},
            "$inc": {"delivery_attempts": 1},
        },
        return_document=ReturnDocument.AFTER,
    )


async def mark_shopify_activation_delivered(collection, license_key: str):
    """Record delivery completion without exposing the activation code."""
    result = await collection.update_one(
        {
            "shopify_license_key": license_key,
            "delivery_status": "sending",
        },
        {
            "$set": {
                "delivery_status": "delivered",
                "delivered_at": datetime.now(timezone.utc),
            },
            "$unset": {"delivery_claimed_at": "", "delivery_last_error": ""},
        },
    )
    return result.matched_count == 1


async def mark_shopify_activation_delivery_failed(
    collection,
    license_key: str,
    reason: str = "delivery_failed",
):
    """Leave the encrypted code recoverable for a later safe retry."""
    result = await collection.update_one(
        {
            "shopify_license_key": license_key,
            "delivery_status": "sending",
        },
        {
            "$set": {
                "delivery_status": "failed",
                "delivery_last_error": reason,
                "delivery_failed_at": datetime.now(timezone.utc),
            },
            "$unset": {"delivery_claimed_at": ""},
        },
    )
    return result.matched_count == 1


async def record_shopify_order_state(
    collection,
    shop_domain: str,
    order_id: str,
    state: str,
):
    """Durably record cancellation/refund state without revoking access."""
    await collection.update_one(
        {
            "shop_domain": shop_domain.strip().lower(),
            "order_id": str(order_id),
        },
        {
            "$set": {
                "state": state,
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {
                "created_at": datetime.now(timezone.utc),
            },
        },
        upsert=True,
    )


async def get_shopify_order_state(collection, shop_domain: str, order_id: str):
    return await collection.find_one({
        "shop_domain": shop_domain.strip().lower(),
        "order_id": str(order_id),
    })


def verify_shopify_webhook(
    raw_body: bytes,
    shopify_hmac: str,
    webhook_secret: str,
) -> bool:
    """Verify Shopify's HMAC-SHA256 webhook signature."""
    if not webhook_secret or not shopify_hmac:
        return False

    digest = hmac.new(
        webhook_secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).digest()

    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, shopify_hmac.strip())
