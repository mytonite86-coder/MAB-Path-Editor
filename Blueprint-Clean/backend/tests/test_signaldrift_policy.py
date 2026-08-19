import unittest

from signaldrift_event_types import (
    CANONICAL_PATHSEAL_EVENT_TYPES,
    LEGACY_SIGNALDRIFT_EVENT_TYPES,
    SIGNALDRIFT_EVENT_TYPES,
)


class SignalDriftRelayPolicyTests(unittest.TestCase):
    def test_complete_canonical_vocabulary_is_allowed(self):
        self.assertTrue(
            CANONICAL_PATHSEAL_EVENT_TYPES.issubset(
                SIGNALDRIFT_EVENT_TYPES
            )
        )

    def test_legacy_events_remain_accepted(self):
        self.assertEqual(
            LEGACY_SIGNALDRIFT_EVENT_TYPES,
            {"visit", "signup", "upload", "subscription"},
        )
        self.assertTrue(
            LEGACY_SIGNALDRIFT_EVENT_TYPES.issubset(
                SIGNALDRIFT_EVENT_TYPES
            )
        )

    def test_unknown_events_are_not_in_the_contract(self):
        self.assertNotIn(
            "purchase-ish",
            SIGNALDRIFT_EVENT_TYPES,
        )


if __name__ == "__main__":
    unittest.main()
