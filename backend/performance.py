"""Request-scoped monotonic timings. No question, image, response or key is logged."""

from __future__ import annotations

import contextvars
import functools
import inspect
import json
import logging
import math
import os
import re
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_CURRENT = contextvars.ContextVar("medix_performance", default=None)
_PARENT = contextvars.ContextVar("medix_performance_parent", default=None)
_LOGGER = logging.getLogger(__name__)


def enabled():
    return os.getenv("MEDIX_PERFORMANCE_ENABLED", "1").lower() not in {"0", "false", "off"}


class PerformanceTrace:
    def __init__(self, request_id=None, *, layer="backend", route="offline"):
        self.request_id = (
            request_id
            if request_id and re.fullmatch(r"[a-fA-F0-9-]{16,36}", request_id)
            else uuid.uuid4().hex
        )
        self.layer = layer
        self.route = route
        self.started = time.perf_counter()
        self.timestamp = datetime.now(timezone.utc).isoformat()
        self.spans = []
        self.counters = {}
        self.lock = threading.Lock()

    def elapsed(self):
        return (time.perf_counter() - self.started) * 1000

    @contextmanager
    def activate(self):
        token = _CURRENT.set(self)
        parent = _PARENT.set(None)
        try:
            yield self
        finally:
            _PARENT.reset(parent)
            _CURRENT.reset(token)

    def snapshot(self, *, status="ok", http_status=None):
        with self.lock:
            spans = [dict(s) for s in self.spans]
            counters = dict(self.counters)
        for s in spans:
            # Child spans may overlap: subtract their union, never their sum.
            intervals = sorted(
                (
                    max(s["start_ms"], c["start_ms"]),
                    min(s["start_ms"] + s["duration_ms"], c["start_ms"] + c["duration_ms"]),
                )
                for c in spans
                if c["parent_id"] == s["span_id"]
            )
            covered = 0.0
            end = s["start_ms"]
            for left, right in intervals:
                covered += max(0, right - max(left, end))
                end = max(end, right)
            s["exclusive_ms"] = round(max(0, s["duration_ms"] - covered), 3)
        return {
            "schema_version": 1,
            "request_id": self.request_id,
            "layer": self.layer,
            "route": self.route,
            "started_at": self.timestamp,
            "status": status,
            "http_status": http_status,
            "total_ms": round(self.elapsed(), 3),
            "spans": spans,
            "counters": counters,
        }


@contextmanager
def span(name):
    trace = _CURRENT.get()
    if trace is None:
        yield
        return
    start = trace.elapsed()
    span_id = uuid.uuid4().hex[:16]
    parent_id = _PARENT.get()
    token = _PARENT.set(span_id)
    status = "ok"
    try:
        yield
    except BaseException:
        status = "error"
        raise
    finally:
        _PARENT.reset(token)
        with trace.lock:
            trace.spans.append(
                {
                    "span_id": span_id,
                    "parent_id": parent_id,
                    "name": name,
                    "start_ms": round(start, 3),
                    "duration_ms": round(trace.elapsed() - start, 3),
                    "status": status,
                }
            )


def count(name, amount=1):
    trace = _CURRENT.get()
    if trace:
        with trace.lock:
            trace.counters[name] = trace.counters.get(name, 0) + amount


def timed(name):
    def decorate(fn):
        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args, **kwargs):
                with span(name):
                    return await fn(*args, **kwargs)

            return async_wrapper

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            with span(name):
                return fn(*args, **kwargs)

        return wrapper

    return decorate


def record(trace, *, status="ok", http_status=None):
    """Best effort append-only JSONL; persistence must never break medical requests."""
    if not enabled():
        return
    target = Path(
        os.getenv(
            "MEDIX_PERFORMANCE_LOG",
            str(Path(__file__).resolve().parents[1] / "data/performance/backend.jsonl"),
        )
    )
    try:
        payload = (
            json.dumps(
                trace.snapshot(status=status, http_status=http_status), separators=(",", ":")
            )
            + "\n"
        ).encode()
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(target, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            os.write(descriptor, payload)
        finally:
            os.close(descriptor)
    except OSError:
        _LOGGER.warning("Performance record could not be persisted")


def server_timing_header(trace):
    """Numeric component metrics only; keep prompts and model content private.

    This is measured at response headers, not final delivery. Nested stage
    durations remain inclusive and must not be summed into the total.
    """
    stages = {}
    with trace.lock:
        spans = [dict(item) for item in trace.spans]
    for item in spans:
        name = item["name"]
        duration = item["duration_ms"]
        if not re.fullmatch(r"[a-z][a-z0-9_.]{0,63}", name):
            continue
        if not math.isfinite(duration) or duration < 0:
            continue
        row = stages.setdefault(name, [0.0, 0, 0])
        row[0] += duration
        row[1] += 1
        row[2] += item["status"] == "error"
    metrics = [f"backend_headers;dur={trace.elapsed():.3f}"]
    for name, (duration, calls, errors) in sorted(stages.items()):
        if name == "backend_headers":
            continue
        metric = f"{name};dur={duration:.3f};count={calls};errors={errors}"
        if sum(len(part) + 2 for part in metrics) + len(metric) > 7000:
            break
        metrics.append(metric)
    return ", ".join(metrics)


class PerformanceMiddleware:
    """Pure ASGI: includes body delivery and preserves threadpool contextvars."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("path") not in {"/api/query", "/api/v2/query", "/api/multimodal/query"}
            or not enabled()
        ):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        trace = PerformanceTrace(
            headers.get(b"x-medix-request-id", b"").decode("ascii", errors="ignore"),
            route=scope["path"],
        )
        status_code = 500
        failed = False

        async def traced_send(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                message = {
                    **message,
                    "headers": [
                        *message.get("headers", []),
                        (b"x-medix-request-id", trace.request_id.encode()),
                        (b"server-timing", server_timing_header(trace).encode("ascii")),
                    ],
                }
            await send(message)

        with trace.activate():
            try:
                await self.app(scope, receive, traced_send)
            except BaseException:
                failed = True
                raise
            finally:
                record(
                    trace,
                    status="error" if failed or status_code >= 400 else "ok",
                    http_status=status_code,
                )


class TimedTextEncoder:
    """Transparent adapter around actual inference, including cache-miss-only work."""

    def __init__(self, encoder):
        self.encoder = encoder

    def __getattr__(self, name):
        return getattr(self.encoder, name)

    @timed("model.text_embedding_inference")
    def encode(self, *args, **kwargs):
        return self.encoder.encode(*args, **kwargs)
