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
    BlueprintCreate,
    BlueprintUpdate,
    BlueprintResponse,
    TextToCADRequest,
    ImageToCADRequest,
    AICADResponse,
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
try:
    from ai_service import AICADService
except ModuleNotFoundError:
    AICADService = None

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Collections
users_collection = db.users
blueprints_collection = db.blueprints
ai_generations_collection = db.ai_generations
payment_transactions_collection = db.payment_transactions

# Create the main app without a prefix
app = FastAPI(title="CAD Blueprint API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# AI Service
ai_service = AICADService() if AICADService else None

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

PREMIUM_PACKAGES = {
    "premium_lifetime": {
        "package_id": "premium_lifetime",
        "name": "Premium Lifetime Upgrade",
        "description": "Unlock unlimited AI generations and premium CAD tools.",
        "amount": 19.99,
        "currency": "usd",
        "perks": [
            "Unlimited AI generations",
            "Advanced Part Design tools",
            "Premium export features",
            "Priority image-to-CAD processing",
        ],
    }
}


def configure_stripe() -> None:
    if not STRIPE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Stripe API key is not configured",
        )

    stripe.api_key = STRIPE_API_KEY


def validate_origin_url(origin_url: str) -> str:
    parsed = urlparse(origin_url)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return origin_url.rstrip("/")

    if parsed.scheme and parsed.scheme not in {"http", "https"}:
        return origin_url.rstrip("/")

    raise HTTPException(status_code=400, detail="Invalid origin URL")


def build_checkout_return_urls(origin_url: str) -> tuple[str, str]:
    parsed = urlparse(origin_url)

    if parsed.scheme in {"http", "https"}:
        success_url = (
            f"{origin_url}/profile?session_id={{CHECKOUT_SESSION_ID}}&checkout=success"
        )
        cancel_url = f"{origin_url}/profile?checkout=cancel"
        return success_url, cancel_url

    separator = "&" if "?" in origin_url else "?"
    success_url = (
        f"{origin_url}{separator}session_id={{CHECKOUT_SESSION_ID}}&checkout=success"
    )
    cancel_url = f"{origin_url}{separator}checkout=cancel"
    return success_url, cancel_url


async def apply_premium_upgrade(session_id: str, user_id: str, status_payload) -> bool:
    transaction = await payment_transactions_collection.find_one(
        {"session_id": session_id}
    )
    if not transaction:
        return False

    if transaction.get("processed_upgrade"):
        return True

    now_iso = datetime.now(timezone.utc).isoformat()
    update_result = await payment_transactions_collection.update_one(
        {"session_id": session_id, "processed_upgrade": {"$ne": True}},
        {
            "$set": {
                "status": status_payload.status,
                "payment_status": status_payload.payment_status,
                "amount_total": status_payload.amount_total,
                "currency": status_payload.currency,
                "metadata": status_payload.metadata,
                "processed_upgrade": True,
                "processed_at": now_iso,
                "updated_at": now_iso,
            }
        },
    )

    if update_result.modified_count == 0:
        return True

    await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"is_premium": True}},
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
    }

    result = await users_collection.insert_one(user_doc)
    user_id = str(result.inserted_id)

    # Create access token
    access_token = create_access_token(
        data={"sub": user_id, "email": user_data.email, "is_premium": False}
    )

    user_response = UserResponse(
        id=user_id,
        email=user_data.email,
        username=user_data.username,
        is_premium=False,
        created_at=user_doc["created_at"],
    )

    return TokenResponse(
        access_token=access_token, token_type="bearer", user=user_response
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

    # Create access token
    access_token = create_access_token(
        data={
            "sub": user_id,
            "email": user["email"],
            "is_premium": user.get("is_premium", False),
        }
    )

    user_response = UserResponse(
        id=user_id,
        email=user["email"],
        username=user["username"],
        is_premium=user.get("is_premium", False),
        created_at=user["created_at"],
    )

    return TokenResponse(
        access_token=access_token, token_type="bearer", user=user_response
    )


@api_router.get("/auth/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    user = await users_collection.find_one({"_id": ObjectId(current_user["user_id"])})

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        username=user["username"],
        is_premium=user.get("is_premium", False),
        created_at=user["created_at"],
    )


# --------------------- AI ENDPOINTS ---------------------


@api_router.post("/ai/text-to-cad", response_model=AICADResponse)
async def text_to_cad(
    request: TextToCADRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Convert text description to CAD elements using AI"""
    if ai_service is None:
        raise HTTPException(
        status_code=503,
        detail="AI CAD service is temporarily unavailable",
    )
    try:
        # Generate CAD from text
        result = await ai_service.text_to_cad(request.prompt)

        # Save generation record
        generation_doc = {
            "user_id": current_user["user_id"] if current_user else None,
            "type": "text_to_cad",
            "input": request.prompt,
            "output": result["elements"],
            "generation_id": result["generation_id"],
            "created_at": datetime.utcnow(),
        }
        await ai_generations_collection.insert_one(generation_doc)

        return AICADResponse(**result)

    except Exception as e:
        logger.error(f"Error in text_to_cad: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating CAD from text: {str(e)}",
        )


@api_router.post("/ai/image-to-cad", response_model=AICADResponse)
async def image_to_cad(
    request: ImageToCADRequest,
    current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """Convert image to CAD elements using AI"""
    if ai_service is None:
        raise HTTPException(
        status_code=503,
        detail="AI CAD service is temporarily unavailable",
    )
    try:
        # Generate CAD from image
        result = await ai_service.image_to_cad(
            request.image_base64, request.instructions
        )

        # Save generation record
        generation_doc = {
            "user_id": current_user["user_id"] if current_user else None,
            "type": "image_to_cad",
            "input": f"Image with instructions: {request.instructions or 'None'}",
            "output": result["elements"],
            "generation_id": result["generation_id"],
            "created_at": datetime.utcnow(),
        }
        await ai_generations_collection.insert_one(generation_doc)

        return AICADResponse(**result)

    except Exception as e:
        logger.error(f"Error in image_to_cad: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating CAD from image: {str(e)}",
        )


# --------------------- BLUEPRINT ENDPOINTS ---------------------


@api_router.post("/blueprints", response_model=BlueprintResponse)
async def create_blueprint(
    blueprint: BlueprintCreate, current_user: dict = Depends(get_current_user)
):
    """Create a new blueprint (requires authentication)"""
    blueprint_doc = {
        "user_id": current_user["user_id"],
        "name": blueprint.name,
        "description": blueprint.description,
        "elements": [elem.dict() for elem in blueprint.elements],
        "thumbnail": blueprint.thumbnail,
        "tags": blueprint.tags,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    result = await blueprints_collection.insert_one(blueprint_doc)
    blueprint_doc["id"] = str(result.inserted_id)
    blueprint_doc["_id"] = result.inserted_id

    return BlueprintResponse(
        id=str(result.inserted_id),
        user_id=blueprint_doc["user_id"],
        name=blueprint_doc["name"],
        description=blueprint_doc["description"],
        elements=[elem for elem in blueprint.elements],
        thumbnail=blueprint_doc["thumbnail"],
        tags=blueprint_doc["tags"],
        created_at=blueprint_doc["created_at"],
        updated_at=blueprint_doc["updated_at"],
    )


@api_router.get("/blueprints", response_model=List[BlueprintResponse])
async def get_blueprints(
    current_user: dict = Depends(get_current_user), limit: int = 50, skip: int = 0
):
    """Get all blueprints for current user"""
    cursor = (
        blueprints_collection.find({"user_id": current_user["user_id"]})
        .sort("updated_at", -1)
        .skip(skip)
        .limit(limit)
    )

    blueprints = await cursor.to_list(length=limit)

    return [
        BlueprintResponse(
            id=str(bp["_id"]),
            user_id=bp["user_id"],
            name=bp["name"],
            description=bp.get("description"),
            elements=bp["elements"],
            thumbnail=bp.get("thumbnail"),
            tags=bp.get("tags", []),
            created_at=bp["created_at"],
            updated_at=bp["updated_at"],
        )
        for bp in blueprints
    ]


@api_router.get("/blueprints/{blueprint_id}", response_model=BlueprintResponse)
async def get_blueprint(
    blueprint_id: str, current_user: dict = Depends(get_current_user)
):
    """Get a specific blueprint"""
    try:
        blueprint = await blueprints_collection.find_one(
            {"_id": ObjectId(blueprint_id), "user_id": current_user["user_id"]}
        )
    except:
        raise HTTPException(status_code=400, detail="Invalid blueprint ID")

    if not blueprint:
        raise HTTPException(status_code=404, detail="Blueprint not found")

    return BlueprintResponse(
        id=str(blueprint["_id"]),
        user_id=blueprint["user_id"],
        name=blueprint["name"],
        description=blueprint.get("description"),
        elements=blueprint["elements"],
        thumbnail=blueprint.get("thumbnail"),
        tags=blueprint.get("tags", []),
        created_at=blueprint["created_at"],
        updated_at=blueprint["updated_at"],
    )


@api_router.put("/blueprints/{blueprint_id}", response_model=BlueprintResponse)
async def update_blueprint(
    blueprint_id: str,
    blueprint_update: BlueprintUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update a blueprint"""
    try:
        obj_id = ObjectId(blueprint_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid blueprint ID")

    # Check if blueprint exists and belongs to user
    existing = await blueprints_collection.find_one(
        {"_id": obj_id, "user_id": current_user["user_id"]}
    )

    if not existing:
        raise HTTPException(status_code=404, detail="Blueprint not found")

    # Prepare update data
    update_data = {"updated_at": datetime.utcnow()}

    if blueprint_update.name is not None:
        update_data["name"] = blueprint_update.name
    if blueprint_update.description is not None:
        update_data["description"] = blueprint_update.description
    if blueprint_update.elements is not None:
        update_data["elements"] = [elem.dict() for elem in blueprint_update.elements]
    if blueprint_update.thumbnail is not None:
        update_data["thumbnail"] = blueprint_update.thumbnail
    if blueprint_update.tags is not None:
        update_data["tags"] = blueprint_update.tags

    # Update blueprint
    await blueprints_collection.update_one({"_id": obj_id}, {"$set": update_data})

    # Get updated blueprint
    updated = await blueprints_collection.find_one({"_id": obj_id})

    return BlueprintResponse(
        id=str(updated["_id"]),
        user_id=updated["user_id"],
        name=updated["name"],
        description=updated.get("description"),
        elements=updated["elements"],
        thumbnail=updated.get("thumbnail"),
        tags=updated.get("tags", []),
        created_at=updated["created_at"],
        updated_at=updated["updated_at"],
    )


@api_router.delete("/blueprints/{blueprint_id}")
async def delete_blueprint(
    blueprint_id: str, current_user: dict = Depends(get_current_user)
):
    """Delete a blueprint"""
    try:
        obj_id = ObjectId(blueprint_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid blueprint ID")

    result = await blueprints_collection.delete_one(
        {"_id": obj_id, "user_id": current_user["user_id"]}
    )

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Blueprint not found")

    return {"message": "Blueprint deleted successfully"}


# --------------------- PREMIUM ENDPOINTS ---------------------


@api_router.post("/premium/activate")
async def activate_premium(
    request: dict, current_user: dict = Depends(get_current_user)
):
    """Activate premium features with a code (bypass for testing)"""
    code = request.get("code", "")

    # Simple bypass code for testing
    if code == "CAD_PREMIUM_2025":
        await users_collection.update_one(
            {"_id": ObjectId(current_user["user_id"])}, {"$set": {"is_premium": True}}
        )
        return {"message": "Premium activated successfully!", "is_premium": True}
    else:
        raise HTTPException(status_code=400, detail="Invalid premium code")


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
    success_url, cancel_url = build_checkout_return_urls(origin_url)

    configure_stripe()

    metadata = {
        "user_id": current_user["user_id"],
        "user_email": current_user["email"],
        "package_id": package["package_id"],
        "upgrade_type": "premium",
    }

    session = stripe.checkout.Session.create(
        allow_promotion_codes=True,
        
        mode="payment",
        payment_method_types=["card"],
        line_items=[
            {
                "price_data": {
                    "currency": package["currency"].lower(),
                    "product_data": {
                        "name": package["name"],
                        "description": package["description"],
                    },
                    "unit_amount": int(round(float(package["amount"]) * 100)),
                },
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    transaction_doc = {
        "session_id": session.id,
        "payment_id": session.id,
        "user_id": current_user["user_id"],
        "email": current_user["email"],
        "package_id": package["package_id"],
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

    now_iso = datetime.now(timezone.utc).isoformat()

    await payment_transactions_collection.update_one(
        {"session_id": session_id},
        {
            "$set": {
                "status": stripe_session.status,
                "payment_status": stripe_session.payment_status,
                "amount_total": stripe_session.amount_total,
                "currency": stripe_session.currency,
                "metadata": dict(stripe_session.metadata or {}),
                "updated_at": now_iso,
            }
        },
    )

    if stripe_session.payment_status == "paid":
        await apply_premium_upgrade(
            session_id,
            current_user["user_id"],
            stripe_session,
        )

    user_doc = await users_collection.find_one(
        {"_id": ObjectId(current_user["user_id"])},
        {"_id": 0, "is_premium": 1},
    )

    return PaymentStatusResponse(
        session_id=session_id,
        package_id=transaction["package_id"],
        status=stripe_session.status,
        payment_status=stripe_session.payment_status,
        amount_total=stripe_session.amount_total,
        currency=stripe_session.currency,
        is_premium=bool(user_doc and user_doc.get("is_premium")),
    )


@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET")

    if not webhook_secret:
        raise HTTPException(
            status_code=500,
            detail="Stripe webhook secret is not configured",
        )

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
    stripe_session = event["data"]["object"]

    session_id = stripe_session.get("id")
    payment_status = stripe_session.get("payment_status")
    metadata = dict(stripe_session.get("metadata") or {})

    if session_id:
        transaction = await payment_transactions_collection.find_one(
            {"session_id": session_id},
            {"_id": 0, "user_id": 1},
        )

        now_iso = datetime.now(timezone.utc).isoformat()

        await payment_transactions_collection.update_one(
            {"session_id": session_id},
            {
                "$set": {
                    "status": event_type,
                    "payment_status": payment_status,
                    "metadata": metadata,
                    "updated_at": now_iso,
                }
            },
        )

        if payment_status == "paid" and transaction and transaction.get("user_id"):

            class StatusPayload:
                status = event_type
                payment_status = stripe_session.get("payment_status")
                amount_total = stripe_session.get("amount_total")
                currency = stripe_session.get("currency")
                metadata = dict(stripe_session.get("metadata") or {})

            await apply_premium_upgrade(
                session_id,
                transaction["user_id"],
                StatusPayload(),
            )

    return {"received": True}


# --------------------- HEALTH CHECK ---------------------


@api_router.get("/")
async def root():
    return {"message": "CAD Blueprint API", "status": "running"}


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
