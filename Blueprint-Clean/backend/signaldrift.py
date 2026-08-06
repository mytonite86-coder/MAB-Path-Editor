import asyncio
import json
import os
from urllib import error, request

from fastapi import HTTPException


SIGNALDRIFT_EVENT_TYPES = {
    "visit",
    "signup",
    "upload",
    "checkout_started",
    "subscription",
}


def build_signaldrift_event(product: str, event: dict) -> dict:
    event_type = _clean(event.get("type"), 80)
    if event_type not in SIGNALDRIFT_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported analytics event")

    return {
        "product": _clean(product, 80),
        "type": event_type,
        "visitorId": _clean(event.get("visitorId"), 120),
        "userId": _clean(event.get("userId"), 120),
        "source": _clean(event.get("source"), 120) or "direct",
        "medium": _clean(event.get("medium"), 120),
        "campaign": _clean(event.get("campaign"), 200),
        "occurredAt": _clean(event.get("occurredAt"), 80),
    }


async def forward_signaldrift_event(payload: dict) -> None:
    endpoint = os.environ.get("SIGNALDRIFT_URL", "").rstrip("/")
    ingest_key = os.environ.get("SIGNALDRIFT_INGEST_KEY", "")
    if not endpoint or not ingest_key:
        raise HTTPException(
            status_code=503,
            detail="Analytics relay is not configured",
        )

    await asyncio.to_thread(_post_event, endpoint, ingest_key, payload)


def _post_event(endpoint: str, ingest_key: str, payload: dict) -> None:
    outbound = request.Request(
        f"{endpoint}/api/events",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {ingest_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(outbound, timeout=5) as response:
            if response.status != 202:
                raise HTTPException(
                    status_code=502,
                    detail="Analytics service rejected the event",
                )
    except HTTPException:
        raise
    except (error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Analytics service is unavailable",
        ) from exc


def _clean(value, max_length: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]
