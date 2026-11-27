"""Password recovery for the shared S&K account, using the verified email address."""
import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

from auth import get_password_hash
from shopify_delivery import send_password_reset_email

PUBLIC_RESET_RESPONSE = {"message": "If an account matches, a password reset link will be sent."}
RESET_URL = "https://mytonite86-coder.github.io/svg-path-closer/#reset-password="
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")
logger = logging.getLogger(__name__)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmation(BaseModel):
    token: str = Field(min_length=43, max_length=43)
    password: str = Field(min_length=12, max_length=72)

    @field_validator("password")
    @classmethod
    def check_bcrypt_limit(cls, password: str):
        if len(password.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes.")
        return password


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def within_rate_limit(collection, request: Request, action: str, limit: int) -> bool:
    now = datetime.now(timezone.utc)
    remote = request.client.host if request.client else "unknown"
    bucket = int(now.timestamp()) // 3600
    key = f"{action}:{digest(remote)}:{bucket}"
    increase = {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now + timedelta(hours=2)}}
    try:
        result = await collection.find_one_and_update(
            {"_id": key}, increase, upsert=True, return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        result = await collection.find_one_and_update(
            {"_id": key}, increase, return_document=ReturnDocument.AFTER,
        )
    if result is None:
        return False
    return result["count"] <= limit


async def request_reset(users, email: str):
    """Run after the generic response, keeping account existence out of the response timing."""
    now = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    token_digest = digest(token)
    try:
        # Account cooldown is atomic. Multiple near-simultaneous requests cannot mail many links.
        account = await users.find_one_and_update(
            {"email": email, "$or": [
                {"password_reset.requested_at": {"$lte": now - timedelta(minutes=5)}},
                {"password_reset.requested_at": {"$exists": False}},
            ]},
            {"$set": {"password_reset": {
                "digest": token_digest, "requested_at": now, "expires_at": now + timedelta(minutes=30),
            }}},
            projection={"email": 1},
            return_document=ReturnDocument.AFTER,
        )
        if account:
            try:
                await run_in_threadpool(send_password_reset_email, account["email"], RESET_URL + token)
                logger.info("Password reset email accepted by Gmail.")
            except RuntimeError:
                # Remove the undeliverable token while retaining the per-account cooldown.
                await users.update_one(
                    {"_id": account["_id"], "password_reset.digest": token_digest},
                    {"$unset": {"password_reset.digest": "", "password_reset.expires_at": ""}},
                )
                logger.warning("Password reset mail delivery failed.")
    except Exception:
        logger.error("Password reset processing failed.")


async def confirm_reset(users, token: str, password: str):
    unavailable = HTTPException(400, "This reset link is invalid or expired. Request a new link.")
    if not TOKEN_PATTERN.fullmatch(token):
        raise unavailable
    condition = {"password_reset.digest": digest(token),
                 "password_reset.expires_at": {"$gt": datetime.now(timezone.utc)}}
    account = await users.find_one(condition, {"_id": 1})
    if not account:
        raise unavailable
    password_hash = await run_in_threadpool(get_password_hash, password)
    condition["_id"] = account["_id"]
    condition["password_reset.expires_at"]["$gt"] = datetime.now(timezone.utc)
    result = await users.update_one(condition, {
        "$set": {"password": password_hash},
        "$unset": {"password_reset": ""},
        "$inc": {"password_version": 1},
    })
    if not result.modified_count:
        raise unavailable
    return {"message": "Password updated. Sign in with your new password."}


def register_password_reset_routes(router, collections):
    @router.post("/auth/password-reset/request", status_code=202)
    async def request_link(body: PasswordResetRequest, request: Request, tasks: BackgroundTasks):
        users, limits = collections()
        if await within_rate_limit(limits, request, "password-reset-request", 12):
            tasks.add_task(request_reset, users, str(body.email))
        return PUBLIC_RESET_RESPONSE

    @router.post("/auth/password-reset/confirm")
    async def reset_password(body: PasswordResetConfirmation, request: Request):
        users, limits = collections()
        if not await within_rate_limit(limits, request, "password-reset-confirm", 25):
            raise HTTPException(429, "Too many attempts. Try again later.")
        return await confirm_reset(users, body.token, body.password)
