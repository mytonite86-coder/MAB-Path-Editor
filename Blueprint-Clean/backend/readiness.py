import asyncio
import os
from collections.abc import Mapping


REQUIRED_RUNTIME_SETTINGS = (
    "MONGO_URL",
    "DB_NAME",
    "JWT_SECRET",
    "EMERGENT_LLM_KEY",
    "STRIPE_API_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SIGNALDRIFT_URL",
    "SIGNALDRIFT_INGEST_KEY",
    "ALL_PRODUCTS_LIFETIME_PROMOTION_CODE_ID",
)


def missing_runtime_settings(
    environment: Mapping[str, str] | None = None,
) -> list[str]:
    values = environment if environment is not None else os.environ
    return sorted(
        name
        for name in REQUIRED_RUNTIME_SETTINGS
        if not values.get(name, "").strip()
    )


async def build_readiness_report(
    database_client,
    environment: Mapping[str, str] | None = None,
    timeout_seconds: float = 3.0,
) -> dict:
    missing = missing_runtime_settings(environment)
    configuration = {
        "status": "ready" if not missing else "missing",
        "missing": missing,
    }

    try:
        await asyncio.wait_for(
            database_client.admin.command("ping"),
            timeout=timeout_seconds,
        )
        database_status = "ready"
    except Exception:
        database_status = "unavailable"

    ready = not missing and database_status == "ready"
    return {
        "status": "ready" if ready else "not_ready",
        "ready": ready,
        "components": {
            "configuration": configuration,
            "mongodb": {
                "status": database_status,
            },
        },
    }
