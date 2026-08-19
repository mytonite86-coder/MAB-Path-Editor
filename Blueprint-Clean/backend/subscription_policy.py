PATHSEAL_GRANT_STATUSES = {
    "active",
    "trialing",
    "past_due",
}

PATHSEAL_REVOKE_STATUSES = {
    "canceled",
    "unpaid",
    "incomplete_expired",
    "paused",
}


def pathseal_access_action(subscription_status: str) -> str:
    """Return the deliberate access transition for a Stripe subscription status."""
    if subscription_status in PATHSEAL_GRANT_STATUSES:
        return "grant"

    if subscription_status in PATHSEAL_REVOKE_STATUSES:
        return "revoke"

    return "hold"
