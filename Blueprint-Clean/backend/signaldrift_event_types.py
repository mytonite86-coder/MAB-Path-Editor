CANONICAL_PATHSEAL_EVENT_TYPES = {
    "landing_visit",
    "upload_started",
    "scan_completed",
    "account_created",
    "login_completed",
    "repair_selected",
    "checkout_started",
    "payment_completed",
    "validated_download_completed",
    "error",
}

LEGACY_SIGNALDRIFT_EVENT_TYPES = {
    "visit",
    "signup",
    "upload",
    "subscription",
}

SIGNALDRIFT_EVENT_TYPES = (
    CANONICAL_PATHSEAL_EVENT_TYPES
    | LEGACY_SIGNALDRIFT_EVENT_TYPES
)
