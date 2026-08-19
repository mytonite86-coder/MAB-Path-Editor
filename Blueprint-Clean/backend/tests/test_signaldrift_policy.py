import unittest

from fastapi import HTTPException

from signaldrift import (
    SIGNALDRIFT_EVENT_TYPES,
    build_signaldrift_event,
)


CANONICAL_PATHSEAL_EVENTS = {
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


class SignalDriftRelayPolicyTests(unittest.TestCase):
    def test_complete_canonical_vocabulary_is_allowed(self):
        self.assertTrue(
            CANONICAL_PATHSEAL_EVENTS.issubset(
                SIGNALDRIFT_EVENT_TYPES
            )
        )

        for event_type in CANONICAL_PATHSEAL_EVENTS:
            with self.subTest(event_type=event_type):
                payload = build_signaldrift_event(
                    "pathseal",
                    {
                        "type": event_type,
                        "visitorId": "visitor-1",
                        "source": "facebook",
                        "medium": "social",
                        "campaign": "pathseal-campaign-01",
                    },
                )
                self.assertEqual(payload["type"], event_type)
                self.assertEqual(payload["product"], "pathseal")

    def test_legacy_events_remain_accepted(self):
        for event_type in ("visit", "signup", "upload", "subscription"):
            with self.subTest(event_type=event_type):
                payload = build_signaldrift_event(
                    "pathseal",
                    {"type": event_type},
                )
                self.assertEqual(payload["type"], event_type)

    def test_unknown_events_are_rejected(self):
        with self.assertRaises(HTTPException) as context:
            build_signaldrift_event(
                "pathseal",
                {"type": "purchase-ish"},
            )

        self.assertEqual(context.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
