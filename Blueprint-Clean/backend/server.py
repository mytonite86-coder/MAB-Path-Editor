from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional
from bson import ObjectId
from urllib.parse import urlparse
import stripe

from models import (
    UserCreate,
    UserLogin,
    TokenResponse,
    UserResponse,
  
    PaymentPackageResponse,
    CreateCheckoutSessionRequest,
    CreateCheckoutSessionResponse,
    PaymentStatusResponse,
)
from auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    get_current_user_optional,
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Collections
users_collection = db.users

payment_transactions_collection = db.payment_transactions

# Create the main app without a prefix
app = FastAPI(title="CAD Blueprint API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")



# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

PREMIUM_PACKAGES = {
    "premium_lifetime": {
        "package_id": "premium_lifetime",
        "product_id": "mab_s1",
        "name": "M.A.B. S1 Lifetime Unlock",
        "description": (
            "Unlock premium editing and export tools in M.A.B. S1."
        ),
        "amount": 19.99,
        "currency": "usd",
        "billing_mode": "payment",
        "interval": None,
        "perks": [
            "Unlimited G-code editing",
            "Export edited CNC files",
            "Copy edited G-code",
            "Lifetime M.A.B. S1 premium access",
        ],
    },
    "pathseal_monthly": {
        "package_id": "pathseal_monthly",
        "product_id": "pathseal",
        "name": "PathSeal Founder Access",
        "description": (
            "Scan, review, repair, validate, and download cleaned SVG files."
        ),
        "amount": 9.99,
        "currency": "usd",
        "billing_mode": "subscription",
        "interval": "month",
        "perks": [
            "Unlimited PathSeal repairs",
            "Numbered open-path review",
            "Validated clean SVG downloads",
            "Founder launch pricing",
        ],
    },
}


def configure_stripe() -> None:
    if not STRIPE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Stripe API key is not configured",
        )

    stripe.api_key = STRIPE_API_KEY
def get_user_entitlements(user: dict) -> list[str]:
    entitlements = set(user.get("entitlements") or [])

    # Preserve access for existing M.A.B. premium customers.
    if user.get("is_premium", False):
        entitlements.add("mab_s1")

    return sorted(entitlements)


def build_user_response(
    user: dict,
    user_id: Optional[str] = None,
) -> UserResponse:
    resolved_user_id = user_id or str(user["_id"])

    return UserResponse(
        id=resolved_user_id,
        email=user["email"],
        username=user["username"],
        is_premium=user.get("is_premium", False),
        entitlements=get_user_entitlements(user),
        created_at=user["created_at"],
    )


def build_access_token_for_user(
    user_id: str,
    user: dict,
) -> str:
    return create_access_token(
        data={
            "sub": user_id,
            "email": user["email"],
            "is_premium": user.get("is_premium", False),
            "entitlements": get_user_entitlements(user),
        }
    )

def validate_origin_url(origin_url: str) -> str:
    parsed = urlparse(origin_url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return origin_url.rstrip("/")

    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return origin_url.rstrip("/")

    raise HTTPException(status_code=400, detail="Invalid origin URL")


def build_checkout_return_urls(
    origin_url: str,
    product_id: str,
) -> tuple[str, str]:
    parsed = urlparse(origin_url)

    if parsed.scheme in {"http", "https"} and parsed.netloc:
        if parsed.netloc == "mytonite86-coder.github.io":
            if product_id == "mab_s1":
                base_url = (
                    f"{parsed.scheme}://{parsed.netloc}/MAB-Path-Editor"
                )
                return_target = f"{base_url}/profile"

            elif product_id == "pathseal":
                base_url = (
                    f"{parsed.scheme}://{parsed.netloc}/svg-path-closer"
                )
                return_target = base_url

            else:
                return_target = origin_url.rstrip("/")
        else:
            base_url = origin_url.rstrip("/")

            if product_id == "mab_s1":
                return_target = f"{base_url}/profile"
            else:
                return_target = base_url

        separator = "&" if "?" in return_target else "?"

        success_url = (
            f"{return_target}{separator}"
            "session_id={CHECKOUT_SESSION_ID}&checkout=success"
        )
        cancel_url = (
            f"{return_target}{separator}checkout=cancel"
        )

        return success_url, cancel_url

    separator = "&" if "?" in origin_url else "?"

    success_url = (
        f"{origin_url}{separator}"
        "session_id={CHECKOUT_SESSION_ID}&checkout=success"
    )
    cancel_url = (
        f"{origin_url}{separator}checkout=cancel"
    )

    return success_url, cancel_url
PATHSEAL_GRANT_STATUSES = {
    "active",
    "trialing",
}

PATHSEAL_REVOKE_STATUSES = {
    "canceled",
    "unpaid",
    "incomplete_expired",
    "paused",
}


def stripe_value(stripe_object, key: str, default=None):
    if stripe_object is None:
        return default

    if isinstance(stripe_object, dict):
        return stripe_object.get(key, default)

    return getattr(stripe_object, key, default)


def stripe_id(stripe_object):
    if stripe_object is None:
        return None

    if isinstance(stripe_object, str):
        return stripe_object

    return stripe_value(stripe_object, "id")
def stripe_dict(stripe_object) -> dict:
    if stripe_object is None:
        return {}

    if isinstance(stripe_object, dict):
        return dict(stripe_object)

    to_dict_recursive = getattr(
        stripe_object,
        "to_dict_recursive",
        None,
    )

    if callable(to_dict_recursive):
        return to_dict_recursive()

    return {}


def get_subscription_period_end(subscription):
    period_end = stripe_value(
        subscription,
        "current_period_end",
    )

    if period_end is not None:
        return period_end

    items = stripe_value(subscription, "items", {}) or {}
    item_data = stripe_value(items, "data", []) or []

    if item_data:
        return stripe_value(
            item_data[0],
            "current_period_end",
        )

    return None

async def grant_product_entitlement(
    user_id: str,
    product_id: str,
) -> None:
    update_document = {
        "$addToSet": {
            "entitlements": product_id,
        }
    }

    if product_id == "mab_s1":
        update_document["$set"] = {
            "is_premium": True,
        }

    await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        update_document,
    )


async def revoke_product_entitlement(
    user_id: str,
    product_id: str,
) -> None:
    if product_id == "mab_s1":
        return

    await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$pull": {
                "entitlements": product_id,
            }
        },
    )


async def apply_premium_upgrade(
    session_id: str,
    user_id: str,
    status_payload,
) -> bool:
    transaction = await payment_transactions_collection.find_one(
        {"session_id": session_id}
    )

    if not transaction:
        return False

    product_id = transaction.get(
        "product_id",
        "mab_s1",
    )

    if product_id != "mab_s1":
        return False

    if transaction.get("processed_upgrade"):
        return True

    now_iso = datetime.now(timezone.utc).isoformat()

    update_result = await payment_transactions_collection.update_one(
        {
            "session_id": session_id,
            "processed_upgrade": {"$ne": True},
        },
        {
            "$set": {
                "status": stripe_value(
                    status_payload,
                    "status",
                    "complete",
                ),
                "payment_status": stripe_value(
                    status_payload,
                    "payment_status",
                    "paid",
                ),
                "amount_total": stripe_value(
                    status_payload,
                    "amount_total",
                ),
                "currency": stripe_value(
                    status_payload,
                    "currency",
                ),
                "metadata": stripe_dict(
                    stripe_value(
                        status_payload,
                        "metadata",
                    )
                ),
                "processed_upgrade": True,
                "access_active": True,
                "processed_at": now_iso,
                "updated_at": now_iso,
            }
        },
    )

    if update_result.modified_count == 0:
        return True

    await grant_product_entitlement(
        user_id,
        "mab_s1",
    )

    return True
async def sync_pathseal_subscription(
    subscription,
    event_type: Optional[str] = None,
) -> bool:
    subscription_id = stripe_id(subscription)

    if not subscription_id:
        return False

    metadata = stripe_dict(
        stripe_value(
            subscription,
            "metadata",
        )
    )

    user_id = metadata.get("user_id")
    package_id = metadata.get("package_id")
    product_id = metadata.get("product_id")

    transaction = await payment_transactions_collection.find_one(
        {
            "subscription_id": subscription_id,
        },
        sort=[("created_at", -1)],
    )

    if not transaction and user_id and package_id:
        transaction = await payment_transactions_collection.find_one(
            {
                "user_id": user_id,
                "package_id": package_id,
            },
            sort=[("created_at", -1)],
        )

    if transaction:
        user_id = user_id or transaction.get("user_id")
        package_id = package_id or transaction.get("package_id")
        product_id = product_id or transaction.get("product_id")

    if not product_id and package_id == "pathseal_monthly":
        product_id = "pathseal"

    if not user_id or product_id != "pathseal":
        logger.warning(
            "Could not resolve PathSeal subscription owner: %s",
            subscription_id,
        )
        return False

    subscription_status = stripe_value(
        subscription,
        "status",
        "",
    )

    update_fields = {
        "product_id": "pathseal",
        "subscription_id": subscription_id,
        "subscription_status": subscription_status,
        "customer_id": stripe_id(
            stripe_value(
                subscription,
                "customer",
            )
        ),
        "current_period_end": get_subscription_period_end(
            subscription
        ),
        "cancel_at_period_end": bool(
            stripe_value(
                subscription,
                "cancel_at_period_end",
                False,
            )
        ),
        "canceled_at": stripe_value(
            subscription,
            "canceled_at",
        ),
        "ended_at": stripe_value(
            subscription,
            "ended_at",
        ),
        "latest_invoice_id": stripe_id(
            stripe_value(
                subscription,
                "latest_invoice",
            )
        ),
        "subscription_metadata": metadata,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }

    if event_type:
        update_fields["last_event_type"] = event_type

    if subscription_status in PATHSEAL_GRANT_STATUSES:
        update_fields["access_active"] = True

    elif subscription_status in PATHSEAL_REVOKE_STATUSES:
        update_fields["access_active"] = False

    if transaction:
        await payment_transactions_collection.update_one(
            {
                "_id": transaction["_id"],
            },
            {
                "$set": update_fields,
            },
        )

    if subscription_status in PATHSEAL_GRANT_STATUSES:
        await grant_product_entitlement(
            user_id,
            "pathseal",
        )

    elif subscription_status in PATHSEAL_REVOKE_STATUSES:
        other_active_subscription = (
            await payment_transactions_collection.find_one(
                {
                    "user_id": user_id,
                    "product_id": "pathseal",
                    "subscription_id": {
                        "$ne": subscription_id,
                    },
                    "access_active": True,
                }
            )
        )

        if not other_active_subscription:
            await revoke_product_entitlement(
                user_id,
                "pathseal",
            )

    return True
async def process_checkout_session(
    stripe_session,
    event_type: Optional[str] = None,
) -> bool:
    session_id = stripe_id(stripe_session)

    if not session_id:
        return False

    transaction = await payment_transactions_collection.find_one(
        {
            "session_id": session_id,
        }
    )

    if not transaction:
        logger.warning(
            "No local transaction found for Stripe session: %s",
            session_id,
        )
        return False

    metadata = stripe_dict(
        stripe_value(
            stripe_session,
            "metadata",
        )
    )

    product_id = (
        transaction.get("product_id")
        or metadata.get("product_id")
        or "mab_s1"
    )

    billing_mode = (
        transaction.get("billing_mode")
        or metadata.get("billing_mode")
        or "payment"
    )

    payment_status = stripe_value(
        stripe_session,
        "payment_status",
        transaction.get("payment_status", "pending"),
    )

    subscription_id = stripe_id(
        stripe_value(
            stripe_session,
            "subscription",
        )
    )

    customer_id = stripe_id(
        stripe_value(
            stripe_session,
            "customer",
        )
    )

    update_fields = {
        "product_id": product_id,
        "billing_mode": billing_mode,
        "status": stripe_value(
            stripe_session,
            "status",
            transaction.get("status", "open"),
        ),
        "payment_status": payment_status,
        "amount_total": stripe_value(
            stripe_session,
            "amount_total",
        ),
        "currency": stripe_value(
            stripe_session,
            "currency",
            transaction.get("currency"),
        ),
        "customer_id": customer_id,
        "subscription_id": subscription_id,
        "metadata": metadata,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
    }

    if event_type:
        update_fields["last_event_type"] = event_type

    await payment_transactions_collection.update_one(
        {
            "session_id": session_id,
        },
        {
            "$set": update_fields,
        },
    )

    if product_id == "mab_s1" and payment_status == "paid":
        return await apply_premium_upgrade(
            session_id,
            transaction["user_id"],
            stripe_session,
        )

    if product_id == "pathseal" and subscription_id:
        configure_stripe()

        try:
            subscription = stripe.Subscription.retrieve(
                subscription_id
            )
        except stripe.error.StripeError as exc:
            logger.warning(
                "Unable to retrieve PathSeal subscription %s: %s",
                subscription_id,
                str(exc),
            )
            return False

        return await sync_pathseal_subscription(
            subscription,
            event_type=event_type,
        )

    return True


# --------------------- AUTH ENDPOINTS ---------------------


@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    """Register a new user"""
    # Check if user already exists
    existing_user = await users_collection.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    # Check if username is taken
    existing_username = await users_collection.find_one(
        {"username": user_data.username}
    )
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken"
        )

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    user_doc = {
        "email": user_data.email,
        "username": user_data.username,
        "password": hashed_password,
        "is_premium": False,
        "created_at": datetime.utcnow(),
        "entitlements": [],
    }

    result = await users_collection.insert_one(user_doc)
    user_id = str(result.inserted_id)

    user_doc["_id"] = result.inserted_id

    access_token = build_access_token_for_user(
    user_id,
    user_doc,
    )

    user_response = build_user_response(
    user_doc,
    user_id,
    )

    return TokenResponse(
    access_token=access_token,
    token_type="bearer",
    user=user_response,
    )   


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    """Login user"""
    # Find user by email
    user = await users_collection.find_one({"email": credentials.email})

    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    user_id = str(user["_id"])

    access_token = build_access_token_for_user(
    user_id,
    user,
    )

    user_response = build_user_response(user)

    return TokenResponse(
    access_token=access_token,
    token_type="bearer",
    user=user_response,
    )


@api_router.get("/auth/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    user = await users_collection.find_one({"_id": ObjectId(current_user["user_id"])})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return build_user_response(user)



# --------------------- PREMIUM ENDPOINTS ---------------------


@api_router.post("/premium/activate")
async def activate_premium(
    request: dict, current_user: dict = Depends(get_current_user)
):
    raise HTTPException(
        status_code=501,
        detail="Premium activation endpoint not implemented",
    )

@api_router.get("/payments/packages", response_model=List[PaymentPackageResponse])
async def get_payment_packages():
    return [PaymentPackageResponse(**package) for package in PREMIUM_PACKAGES.values()]


@api_router.post(
    "/payments/checkout/session",
    response_model=CreateCheckoutSessionResponse,
)
async def create_checkout_session(
    checkout_request: CreateCheckoutSessionRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    package = PREMIUM_PACKAGES.get(checkout_request.package_id)

    if not package:
        raise HTTPException(
            status_code=400,
            detail="Invalid package selected",
        )

    origin_url = validate_origin_url(checkout_request.origin_url)
    success_url, cancel_url = build_checkout_return_urls(
    origin_url,
    package["product_id"],
)
    configure_stripe()

    metadata = {
        "user_id": current_user["user_id"],
        "user_email": current_user["email"],
        "package_id": package["package_id"],
        "product_id": package["product_id"],
        "billing_mode": package["billing_mode"],
        "interval": package["interval"] or "",
        "upgrade_type": "premium",
    }
    price_data = {
        "currency": package["currency"].lower(),
        "product_data": {
            "name": package["name"],
            "description": package["description"],
        },
        "unit_amount": int(
            round(float(package["amount"]) * 100)
        ),
    }

    if package["billing_mode"] == "subscription":
        price_data["recurring"] = {
            "interval": package["interval"],
            "interval_count": 1,
        }
    billing_data = {}

    if package["billing_mode"] == "subscription":
        billing_data["subscription_data"] = {
            "metadata": metadata,
        }
    else:
        billing_data["payment_intent_data"] = {
            "metadata": metadata,
        }

    session = stripe.checkout.Session.create(
        allow_promotion_codes=True,
        
        mode=package["billing_mode"],
        payment_method_types=["card"],
        line_items=[
            {
                "price_data": price_data,
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
        **billing_data,
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    transaction_doc = {
        "session_id": session.id,
        "payment_id": session.id,
        "user_id": current_user["user_id"],
        "email": current_user["email"],
        "package_id": package["package_id"],
        "product_id": package["product_id"],
        "billing_mode": package["billing_mode"],
        "interval": package["interval"],
        "customer_id": None,
        "subscription_id": None,
        "subscription_status": None,
        "access_active": False,
        "amount": package["amount"],
        "currency": package["currency"],
        "metadata": metadata,
        "status": "open",
        "payment_status": "pending",
        "processed_upgrade": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    await payment_transactions_collection.insert_one(transaction_doc)

    return CreateCheckoutSessionResponse(
        url=session.url,
        session_id=session.id,
    )


@api_router.get(
    "/payments/checkout/status/{session_id}",
    response_model=PaymentStatusResponse,
)
async def get_checkout_status(
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    transaction = await payment_transactions_collection.find_one(
        {
            "session_id": session_id,
            "user_id": current_user["user_id"],
        },
        {"_id": 0},
    )

    if not transaction:
        raise HTTPException(
            status_code=404,
            detail="Payment session not found",
        )

    try:
        stripe_session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to retrieve Stripe checkout session: {str(exc)}",
        )

    await process_checkout_session(
        stripe_session
    )
    transaction = await payment_transactions_collection.find_one(
        {
            "session_id": session_id,
            "user_id": current_user["user_id"],
        },
        {"_id": 0},
    ) 

    user_doc = await users_collection.find_one(
        {"_id": ObjectId(current_user["user_id"])},
        {
            "_id": 0,
            "is_premium": 1,
            "entitlements": 1,
        },
    )
    amount_total = stripe_value(
        stripe_session,
        "amount_total",
    )

    if amount_total is None:
        amount_total = int(
            round(float(transaction["amount"]) * 100)
        ) 

        return PaymentStatusResponse(
        session_id=session_id,
        package_id=transaction["package_id"],
        product_id=transaction.get(
            "product_id",
            "",
        ),
        status=stripe_value(
            stripe_session,
            "status",
            transaction.get("status", "open"),
        ),
        payment_status=stripe_value(
            stripe_session,
            "payment_status",
            transaction.get("payment_status", "pending"),
        ),
        amount_total=amount_total,
        currency=stripe_value(
            stripe_session,
            "currency",
            transaction.get("currency", "usd"),
        ),
        is_premium=bool(
            user_doc and user_doc.get("is_premium")
        ),
        entitlements=get_user_entitlements(
            user_doc or {}
        ),
        subscription_status=transaction.get(
            "subscription_status"
        ),
    )


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

    if not webhook_secret:
        raise HTTPException(
            status_code=500,
            detail="Stripe webhook secret is not configured",
        )
    configure_stripe()

    body = await request.body()
    signature = request.headers.get("Stripe-Signature")

    if not signature:
        raise HTTPException(
            status_code=400,
            detail="Missing Stripe-Signature header",
        )

    try:
        event = stripe.Webhook.construct_event(
            payload=body,
            sig_header=signature,
            secret=webhook_secret,
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid webhook payload",
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(
            status_code=400,
            detail="Invalid Stripe webhook signature",
        )

    event_type = event["type"]
    stripe_object = event["data"]["object"]

    checkout_events = {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
    }

    subscription_events = {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
    }

    if event_type in checkout_events:
        await process_checkout_session(
            stripe_object,
            event_type=event_type,
        )

    elif event_type in subscription_events:
        await sync_pathseal_subscription(
            stripe_object,
            event_type=event_type,
        )

    return {"received": True}


# --------------------- HEALTH CHECK ---------------------



@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[
        "http://localhost:8081",
        "https://mytonite86-coder.github.io",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
