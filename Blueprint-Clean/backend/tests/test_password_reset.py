import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, FastAPI, Depends
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

import password_reset
from auth import create_access_token, get_current_user, get_password_hash, verify_password


def test_reset_link_is_private_single_use_and_revokes_old_session(monkeypatch):
    db = AsyncMongoMockClient().fixture
    delivered = []
    email = "owner@example.com"

    async def seed():
        await db.users.insert_one({"email": email, "password": get_password_hash("old-password-value")})
    asyncio.run(seed())

    def deliver(recipient, link):
        delivered.append((recipient, link.rsplit("=", 1)[1]))
    monkeypatch.setattr(password_reset, "send_password_reset_email", deliver)
    app = FastAPI()
    router = APIRouter()
    password_reset.register_password_reset_routes(router, lambda: (db.users, db.rate_limits))
    app.include_router(router)

    async def version(_):
        record = await db.users.find_one({"email": email})
        return record.get("password_version", 0)

    app.state.password_version_lookup = version

    @app.get("/protected")
    async def protected(user=Depends(get_current_user)):
        return {"subject": user["user_id"]}

    with TestClient(app) as client:
        unknown = client.post("/auth/password-reset/request", json={"email": "missing@example.com"})
        existing = client.post("/auth/password-reset/request", json={"email": email})
        again = client.post("/auth/password-reset/request", json={"email": email})
        assert unknown.status_code == existing.status_code == again.status_code == 202
        assert unknown.json() == existing.json() == again.json()
        assert len(delivered) == 1 and delivered[0][0] == email
        token = delivered[0][1]
        record = asyncio.run(db.users.find_one({"email": email}))
        assert record["password_reset"]["digest"] == password_reset.digest(token)
        assert token not in str(record) and token not in existing.text
        old_token = create_access_token({"sub": str(record["_id"])})
        headers = {"Authorization": "Bearer " + old_token}
        assert client.get("/protected", headers=headers).status_code == 200
        new_password = "fresh-password-value"
        reply = client.post("/auth/password-reset/confirm", json={"token": token, "password": new_password})
        assert reply.status_code == 200
        assert client.post("/auth/password-reset/confirm", json={"token": token, "password": new_password}).status_code == 400
        assert client.get("/protected", headers=headers).status_code == 401
        fresh = asyncio.run(db.users.find_one({"email": email}))
        assert verify_password(new_password, fresh["password"])
        assert "password_reset" not in fresh
        assert fresh["password_version"] == 1


def test_expired_tokens_and_failed_delivery_leave_password_unchanged(monkeypatch):
    db = AsyncMongoMockClient().fixture
    email = "owner@example.com"
    token = "s" * 43

    async def run():
        await db.users.insert_one({"email": email, "password": "existing", "password_reset": {
            "digest": password_reset.digest(token),
            "expires_at": datetime.now(timezone.utc) - timedelta(minutes=1),
         }})
        try:
            await password_reset.confirm_reset(db.users, token, "fresh-password-value")
        except password_reset.HTTPException as error:
            assert error.status_code == 400
        else:
            raise AssertionError("Expired token was accepted")

        def unavailable(*_):
            raise RuntimeError("Mail is unavailable")
        monkeypatch.setattr(password_reset, "send_password_reset_email", unavailable)
        await password_reset.request_reset(db.users, email)
        fresh = await db.users.find_one({"email": email})
        assert fresh["password"] == "existing"
        assert "digest" not in fresh["password_reset"]

    asyncio.run(run())
