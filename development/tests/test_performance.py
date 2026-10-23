"""Exercise real concurrency, failures, context propagation and append-only records."""

import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from starlette.concurrency import run_in_threadpool

from backend.performance import PerformanceMiddleware, PerformanceTrace, count, record, span, timed
from development.evaluation.analyze_performance import summarize
from development.evaluation.review_dataset_questions import audit


def test_nested_exclusive_time_and_error_are_measured():
    trace = PerformanceTrace()
    with trace.activate(), span("parent"):
        with span("child"):
            time.sleep(0.002)
        with pytest.raises(ValueError), span("failed"):
            raise ValueError("private patient content")
    result = trace.snapshot()
    assert len(result["spans"]) == 3
    assert next(s for s in result["spans"] if s["name"] == "failed")["status"] == "error"
    parent = next(s for s in result["spans"] if s["name"] == "parent")
    assert 0 <= parent["exclusive_ms"] <= parent["duration_ms"] <= result["total_ms"] + 0.1
    assert "private patient" not in json.dumps(result)


def test_concurrent_traces_do_not_share_spans_or_counters():
    @timed("worker")
    def work():
        count("hit")
        time.sleep(0.002)

    def run(_):
        t = PerformanceTrace()
        with t.activate():
            work()
        return t.snapshot()

    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(run, range(12)))
    assert len({r["request_id"] for r in results}) == 12
    assert all(len(r["spans"]) == 1 and r["counters"] == {"hit": 1} for r in results)


def test_asgi_full_response_and_threadpool_context(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIX_PERFORMANCE_LOG", str(tmp_path / "records.jsonl"))
    request_id = "a" * 32

    @timed("worker")
    def worker():
        time.sleep(0.002)

    async def app(scope, receive, send):
        await run_in_threadpool(worker)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await asyncio.sleep(0.003)
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    sent = []

    async def send(m):
        sent.append(m)

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
    r = json.loads((tmp_path / "records.jsonl").read_text())
    assert r["request_id"] == request_id and r["status"] == "ok"
    assert r["total_ms"] >= 5
    assert r["spans"][0]["name"] == "worker"
    assert (b"x-medix-request-id", request_id.encode()) in sent[0]["headers"]


def test_failure_and_disabled_logging(tmp_path, monkeypatch):
    file = tmp_path / "records.jsonl"
    monkeypatch.setenv("MEDIX_PERFORMANCE_LOG", str(file))

    async def broken(scope, receive, send):
        raise RuntimeError("private")

    async def noop(*args):
        pass

    with pytest.raises(RuntimeError):
        asyncio.run(
            PerformanceMiddleware(broken)({"type": "http", "path": "/api/query"}, noop, noop)
        )
    assert json.loads(file.read_text())["status"] == "error"
    monkeypatch.setenv("MEDIX_PERFORMANCE_ENABLED", "0")
    record(PerformanceTrace())
    assert len(file.read_text().splitlines()) == 1
    # A broken sink never changes the application's behavior.
    monkeypatch.setenv("MEDIX_PERFORMANCE_ENABLED", "1")
    monkeypatch.setenv("MEDIX_PERFORMANCE_LOG", str(tmp_path))
    record(PerformanceTrace())


def test_summary_joins_layers_without_summing_them():
    records = [
        {
            "schema_version": 1,
            "request_id": "same",
            "layer": layer,
            "status": "ok",
            "total_ms": total,
            "spans": [
                {"name": "repeat", "status": "ok", "duration_ms": d, "exclusive_ms": d}
                for d in [2, 3]
            ],
        }
        for layer, total in [("frontend", 15), ("backend", 10)]
    ]
    result = summarize(records)
    assert result["request_count"] == 1 and result["cross_layer_request_count"] == 1
    assert {r["mean_ms"] for r in result["totals"]} == {10, 15}
    assert all(r["mean_ms"] == 5 for r in result["components"])


def test_dataset_audit_and_train_examples_have_no_label_leakage():
    root = Path(__file__).resolve().parents[2]
    result = audit(root)
    assert result["total_questions"] == 3010
    assert sum(r["explicit_why_count"] for r in result["splits"].values()) == 0
    train = {str(r["sample_id"]): r for r in json.loads((root / "MedVidQA/train.json").read_text())}
    for e in result["runtime_examples"]["examples"]:
        assert e["split"] == "train" and e["question"] == train[e["sample_id"]]["question"]
        assert set(e) == {"sample_id", "split", "question", "intent"}
    assert all(e["derived"] for e in result["derived_why_cases"])


def test_application_validation_errors_record_request_timing(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.application import MedixApplication
    from backend.config import AppSettings, ProjectPaths
    from backend.container import ServiceContainer

    file = tmp_path / "api.jsonl"
    monkeypatch.setenv("MEDIX_PERFORMANCE_LOG", str(file))
    settings = AppSettings.safe_defaults()
    app = MedixApplication(
        settings,
        ProjectPaths.discover(),
        ServiceContainer.unavailable(settings, "test unavailable"),
    ).create()
    with TestClient(app) as client:
        response = client.post("/api/query", json={"query": "hello"})
    assert response.status_code == 503
    row = json.loads(file.read_text())
    assert row["status"] == "error" and row["http_status"] == 503
    assert response.headers["x-medix-request-id"] == row["request_id"]
    assert "hello" not in json.dumps(row)


def test_image_preprocessing_is_timed_without_leaking_bytes():
    import io

    from PIL import Image

    from backend.adapters.structured_vision import StructuredVisionModel

    class ModelClient:
        @timed("model.test_provider")
        def chat(self, model, messages):
            assert messages[1]["content"][1]["image_url"]["url"].startswith(
                "data:image/jpeg;base64,"
            )
            return json.dumps(
                {"visible_objects": ["cloth"], "visible_actions": [], "uncertainty": "uncertain"}
            )

    image = io.BytesIO()
    Image.new("RGB", (40, 40)).save(image, format="PNG")
    trace = PerformanceTrace()
    with trace.activate():
        result = StructuredVisionModel(ModelClient(), "test/model").observe(
            question="What is this?", image_bytes=image.getvalue()
        )
    assert result.visible_objects == ("cloth",)
    snapshot = trace.snapshot()
    assert {s["name"] for s in snapshot["spans"]} == {
        "vision.total",
        "vision.preprocess",
        "model.test_provider",
    }
    assert "base64" not in json.dumps(snapshot) and "What is this" not in json.dumps(snapshot)
