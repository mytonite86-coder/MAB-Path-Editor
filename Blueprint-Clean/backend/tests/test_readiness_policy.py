import asyncio
import unittest

from readiness import (
    REQUIRED_RUNTIME_SETTINGS,
    build_readiness_report,
    missing_runtime_settings,
)


COMPLETE_ENVIRONMENT = {
    name: "configured"
    for name in REQUIRED_RUNTIME_SETTINGS
}


class FakeAdmin:
    def __init__(self, error=None):
        self.error = error

    async def command(self, name):
        if self.error:
            raise self.error
        return {"ok": 1, "command": name}


class FakeClient:
    def __init__(self, error=None):
        self.admin = FakeAdmin(error)


class ReadinessPolicyTests(unittest.TestCase):
    def test_missing_settings_are_reported_by_name_only(self):
        environment = dict(COMPLETE_ENVIRONMENT)
        environment["JWT_SECRET"] = ""
        environment.pop("STRIPE_WEBHOOK_SECRET")

        self.assertEqual(
            missing_runtime_settings(environment),
            ["JWT_SECRET", "STRIPE_WEBHOOK_SECRET"],
        )

    def test_ready_requires_configuration_and_mongodb(self):
        report = asyncio.run(
            build_readiness_report(
                FakeClient(),
                COMPLETE_ENVIRONMENT,
                timeout_seconds=0.1,
            )
        )

        self.assertTrue(report["ready"])
        self.assertEqual(report["status"], "ready")
        self.assertEqual(
            report["components"]["mongodb"]["status"],
            "ready",
        )

    def test_database_failure_returns_not_ready_without_error_details(self):
        report = asyncio.run(
            build_readiness_report(
                FakeClient(RuntimeError("secret connection detail")),
                COMPLETE_ENVIRONMENT,
                timeout_seconds=0.1,
            )
        )

        self.assertFalse(report["ready"])
        self.assertEqual(report["status"], "not_ready")
        self.assertEqual(
            report["components"]["mongodb"]["status"],
            "unavailable",
        )
        self.assertNotIn("secret connection detail", str(report))

    def test_missing_configuration_returns_not_ready(self):
        environment = dict(COMPLETE_ENVIRONMENT)
        environment["SIGNALDRIFT_INGEST_KEY"] = ""

        report = asyncio.run(
            build_readiness_report(
                FakeClient(),
                environment,
                timeout_seconds=0.1,
            )
        )

        self.assertFalse(report["ready"])
        self.assertEqual(
            report["components"]["configuration"]["missing"],
            ["SIGNALDRIFT_INGEST_KEY"],
        )


if __name__ == "__main__":
    unittest.main()
