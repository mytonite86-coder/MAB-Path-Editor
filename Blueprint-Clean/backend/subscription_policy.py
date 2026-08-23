SUBSCRIPTION_GRANT_STATUSES = {
    "active",
    "trialing",
    "past_due",
}

SUBSCRIPTION_REVOKE_STATUSES = {
    "canceled",
    "unpaid",
    "incomplete_expired",
    "paused",
}


def subscription_access_action(subscription_status: str) -> str:
    """Return the deliberate access transition for a Stripe subscription status."""
    if subscription_status in SUBSCRIPTION_GRANT_STATUSES:
        return "grant"

    if subscription_status in SUBSCRIPTION_REVOKE_STATUSES:
        return "revoke"

    return "hold"


# Backwards-compatible name for existing PathSeal callers and tests.
pathseal_access_action = subscription_access_action


def has_any_entitlement(
    entitlements: list[str] | set[str],
    protected_entitlements: set[str],
) -> bool:
    """Return whether access survives removal of a temporary entitlement."""
    return bool(set(entitlements) & protected_entitlements)
