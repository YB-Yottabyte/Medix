"""Public numeric timing transport, including repeated work and failure paths."""

import asyncio
import json

from backend.performance import PerformanceMiddleware, PerformanceTrace, server_timing_header, span


def test_public_header_aggregates_repeated_work_without_inventing_total():
    trace = PerformanceTrace()
    trace.spans = [
        {"name": "model.clip_similarity", "duration_ms": 2.5, "status": "ok"},
        {"name": "model.clip_similarity", "duration_ms": 3.5, "status": "error"},
        {"name": "private\r\npatient", "duration_ms": 99, "status": "ok"},
        {"name": "video.frames", "duration_ms": float("nan"), "status": "ok"},
        {"name": "video.resolve", "duration_ms": -1, "status": "ok"},
    ]
    trace.elapsed = lambda: 20.0
    header = server_timing_header(trace)
    assert "backend_headers;dur=20.000" in header
    assert "model.clip_similarity;dur=6.000;count=2;errors=1" in header
    assert "video.frames" not in header and "video.resolve" not in header
    assert "private" not in header and "patient" not in header
    assert len(header) < 7000


def test_asgi_response_exposes_metrics_without_changing_response_or_logging_private_data(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("MEDIX_PERFORMANCE_LOG", str(tmp_path / "timing.jsonl"))
    monkeypatch.setenv("MEDIX_PERFORMANCE_ENABLED", "1")
    request_id = "a" * 32

    async def app(scope, receive, send):
        with span("retrieval.transcript"):
            await asyncio.sleep(0.001)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b'{"answer":"private medical response"}'})

    sent = []

    async def send(message):
        sent.append(message)

    async def receive():
        return {"type": "http.request", "body": b""}

    asyncio.run(
        PerformanceMiddleware(app)(
            {
                "type": "http",
                "path": "/api/query",
                "headers": [(b"x-medix-request-id", request_id.encode())],
            },
            receive,
            send,
        )
    )
    headers = dict(sent[0]["headers"])
    assert headers[b"x-medix-request-id"].decode() == request_id
    assert b"retrieval.transcript;dur=" in headers[b"server-timing"]
    assert sent[1]["body"] == b'{"answer":"private medical response"}'
    record = (tmp_path / "timing.jsonl").read_text()
    assert json.loads(record)["status"] == "ok"
    assert "private medical response" not in record
    assert b"private medical response" not in headers[b"server-timing"]
