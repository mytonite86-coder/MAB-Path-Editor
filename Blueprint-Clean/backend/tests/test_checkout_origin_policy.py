import os
import unittest
from unittest.mock import patch

from checkout_origins import validate_checkout_origin


class CheckoutOriginPolicyTests(unittest.TestCase):
    def test_production_web_origins_are_allowed(self):
        allowed = (
            "https://mytonite86-coder.github.io",
            "https://mytonite86-coder.github.io/MAB-Path-Editor/",
            "https://mytonite86-coder.github.io/svg-path-closer/",
            "https://mytonite86-coder.github.io/svg-path-closer/pathseal.html",
        )
        for origin in allowed:
            with self.subTest(origin=origin):
                self.assertTrue(validate_checkout_origin(origin))

    def test_mab_mobile_scheme_is_allowed(self):
        self.assertEqual(
            validate_checkout_origin("mabs1patheditor://profile"),
            "mabs1patheditor://profile",
        )

    def test_arbitrary_and_deceptive_origins_are_rejected(self):
        rejected = (
            "https://example.com",
            "https://mytonite86-coder.github.io.evil.example",
            "javascript:alert(1)",
            "https://user:password@mytonite86-coder.github.io",
            "https://mytonite86-coder.github.io?next=https://example.com",
        )
        for origin in rejected:
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    validate_checkout_origin(origin)

    def test_explicit_environment_origin_can_support_staging(self):
        with patch.dict(
            os.environ,
            {"CHECKOUT_ALLOWED_ORIGINS": "https://staging.example.test"},
        ):
            self.assertEqual(
                validate_checkout_origin("https://staging.example.test/"),
                "https://staging.example.test",
            )


if __name__ == "__main__":
    unittest.main()
