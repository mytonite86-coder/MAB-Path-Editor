from datetime import datetime, timezone


ATTRIBUTION_LIMITS = {
    "visitor_id": 120,
    "source": 120,
    "medium": 120,
    "campaign": 200,
}


def normalize_checkout_attribution(value: dict | None) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    normalized = {
        key: _clean(source.get(key), limit)
        for key, limit in ATTRIBUTION_LIMITS.items()
    }
    normalized["source"] = normalized["source"] or "direct"
    return normalized


def attribution_metadata(attribution: dict) -> dict[str, str]:
    normalized = normalize_checkout_attribution(attribution)
    return {
        "sd_visitor_id": normalized["visitor_id"],
        "sd_source": normalized["source"],
        "sd_medium": normalized["medium"],
        "sd_campaign": normalized["campaign"],
    }


def build_payment_completed_event(
    transaction: dict,
    occurred_at: str | None = None,
) -> dict[str, str]:
    attribution = normalize_checkout_attribution(
        transaction.get("attribution")
    )
    return {
        "product": "pathseal",
        "type": "payment_completed",
        "visitorId": attribution["visitor_id"],
        "userId": _clean(transaction.get("user_id"), 120),
        "source": attribution["source"],
        "medium": attribution["medium"],
        "campaign": attribution["campaign"],
        "occurredAt": occurred_at or datetime.now(timezone.utc).isoformat(),
    }


def _clean(value, max_length: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]
