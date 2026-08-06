import json

import pytest
from fastapi import HTTPException

from signaldrift import build_signaldrift_event, _post_event


def test_builds_a_narrow_pathseal_event():
    payload = build_signaldrift_event(
        "pathseal",
        {
            "type": "visit",
            "visitorId": " visitor-1 ",
            "source": "linkedin",
            "medium": "social",
            "campaign": "launch",
            "ignored": "must not cross the relay",
        },
    )

    assert payload == {
        "product": "pathseal",
        "type": "visit",
        "visitorId": "visitor-1",
        "userId": "",
        "source": "linkedin",
        "medium": "social",
        "campaign": "launch",
        "occurredAt": "",
    }


def test_rejects_unknown_event_types():
    with pytest.raises(HTTPException) as exc:
        build_signaldrift_event("pathseal", {"type": "steal_file"})

    assert exc.value.status_code == 400


def test_posts_with_server_side_bearer_key(monkeypatch):
    captured = {}

    class Response:
        status = 202

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def fake_urlopen(outbound, timeout):
        captured["url"] = outbound.full_url
        captured["authorization"] = outbound.headers["Authorization"]
        captured["body"] = json.loads(outbound.data)
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr("signaldrift.request.urlopen", fake_urlopen)
    _post_event(
        "https://signaldrift.example",
        "server-secret",
        {"product": "pathseal", "type": "visit"},
    )

    assert captured == {
        "url": "https://signaldrift.example/api/events",
        "authorization": "Bearer server-secret",
        "body": {"product": "pathseal", "type": "visit"},
        "timeout": 5,
    }
