"""HTTP-level tests for the FastAPI application factory."""

from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

from backend.api.routes import get_kokoro_synthesizer
from backend.application import create_app
from backend.config import AppSettings
from backend.container import ServiceContainer
from tests.fakes import FakeResearchQAService


def make_settings() -> AppSettings:
    return AppSettings.from_mapping(
        {
            "web": {"host": "127.0.0.1", "port": 5001, "debug": False},
            "database": {
                "embedding_model": "test-embeddings",
                "top_k": 3,
                "similarity_threshold": 0.2,
            },
            "ai": {
                "provider": "groq",
                "groq": {
                    "api_key": "",
                    "model": "test-model",
                    "temperature": 0.1,
                    "max_tokens": 100,
                },
            },
            "vision": {
                "model": "test-vision-model",
                "max_image_size": 1024,
                "top_k_matches": 3,
            },
        }
    )


def make_client() -> TestClient:
    settings = make_settings()
    settings = replace(settings, research=replace(settings.research, enabled=True))
    services = ServiceContainer(
        settings=settings,
        qa=FakeResearchQAService(),
    )
    app = create_app(settings=settings, services=services)
    return TestClient(app)


def test_health_reports_initialized_capabilities() -> None:
    response = make_client().get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "canonical_pipeline": {
            "answer_model": "structured_groq",
            "enabled": True,
            "localizer_strategy": "multimodal_window",
            "ready": True,
        },
    }


def test_text_query_uses_canonical_evidence_contract() -> None:
    response = make_client().post("/api/query", json={"query": "How to perform CPR?"})

    assert response.status_code == 200
    assert response.json()["query"] == "How to perform CPR?"
    assert response.json()["pipeline"] == "canonical-medix"
    assert response.json()["citations"][0]["cue_id"] == "T001"


def test_v2_query_is_an_exact_alias_for_canonical_query() -> None:
    client = make_client()
    payload = {"query": "How to perform CPR?"}

    canonical = client.post("/api/query", json=payload)
    alias = client.post("/api/v2/query", json=payload)

    assert canonical.status_code == alias.status_code == 200
    assert canonical.json() == alias.json()


def test_degraded_app_exposes_diagnostics() -> None:
    settings = make_settings()
    settings = replace(settings, research=replace(settings.research, enabled=True))
    services = ServiceContainer.unavailable(settings, "Retrieval cache is missing")
    app = create_app(settings=settings, services=services)

    with TestClient(app) as client:
        health = client.get("/api/health")
        query = client.post("/api/query", json={"query": "CPR"})

    assert health.json()["status"] == "degraded"
    assert query.status_code == 503


def test_openapi_documents_medix_routes() -> None:
    response = make_client().get("/openapi.json")

    assert response.status_code == 200
    assert "/api/query" in response.json()["paths"]
    assert "/api/v2/query" in response.json()["paths"]
    assert "/api/tts" in response.json()["paths"]
    assert "/api/query_video" not in response.json()["paths"]


def test_tts_returns_local_kokoro_wav() -> None:
    class FakeSpeechSynthesizer:
        def synthesize(self, text: str) -> bytes:
            assert text == "Apply pressure."
            return b"RIFF-local-kokoro-wave"

    client = make_client()
    client.app.dependency_overrides[get_kokoro_synthesizer] = lambda: FakeSpeechSynthesizer()

    response = client.post("/api/tts", json={"text": " Apply  pressure. "})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"RIFF-local-kokoro-wave"


def test_research_query_is_fail_closed_when_feature_is_disabled() -> None:
    settings = make_settings()
    services = ServiceContainer(
        settings=settings,
        qa=None,
    )
    client = TestClient(create_app(settings=settings, services=services))

    response = client.post("/api/v2/query", json={"query": "How do I apply pressure?"})

    assert response.status_code == 503
    assert "disabled" in response.json()["error"].lower()


def test_research_query_returns_evidence_provenance_when_enabled() -> None:
    settings = make_settings()
    settings = replace(
        settings,
        research=replace(settings.research, enabled=True),
    )
    services = ServiceContainer(
        settings=settings,
        qa=FakeResearchQAService(),
    )
    client = TestClient(create_app(settings=settings, services=services))

    response = client.post(
        "/api/v2/query",
        json={"query": "  How do I apply pressure?  "},
    )

    assert response.status_code == 200
    assert response.json() == {
        "pipeline": "canonical-medix",
        "query": "How do I apply pressure?",
        "status": "answered",
        "response": "1. Apply direct pressure. [1]",
        "video_id": "video-1",
        "video_url": "https://example.test/video-1",
        "clip_url": ("http://testserver/api/artifacts/media/clips/video-1/clip.mp4"),
        "start_seconds": 12.0,
        "end_seconds": 24.0,
        "confidence": 0.82,
        "safety_disposition": "supported",
        "safety_warning": None,
        "citations": [
            {
                "cue_id": "T001",
                "start_seconds": 13.0,
                "end_seconds": 15.0,
                "clip_start_seconds": 1.0,
                "clip_end_seconds": 3.0,
                "text": "Apply direct pressure to the wound.",
            }
        ],
        "evidence_context": [
            {
                "cue_id": "T001",
                "start_seconds": 13.0,
                "end_seconds": 15.0,
                "clip_start_seconds": 1.0,
                "clip_end_seconds": 3.0,
                "text": "Apply direct pressure to the wound.",
            }
        ],
        "evidence_bundle_id": "bundle-1",
        "abstention_reason": None,
    }


def test_research_query_does_not_fall_back_when_initialization_failed() -> None:
    settings = make_settings()
    settings = replace(
        settings,
        research=replace(settings.research, enabled=True),
    )
    services = ServiceContainer(
        settings=settings,
        qa=None,
        startup_error="Missing local video cache",
    )
    client = TestClient(create_app(settings=settings, services=services))

    response = client.post("/api/v2/query", json={"query": "How do I apply pressure?"})

    assert response.status_code == 503
    assert response.json() == {"error": "Missing local video cache"}


def test_root_describes_the_canonical_api() -> None:
    response = make_client().get("/")

    assert response.status_code == 200
    assert response.json()["query_endpoint"] == "/api/query"


def test_configured_request_size_limit_is_enforced() -> None:
    settings = make_settings()
    settings = replace(settings, web=replace(settings.web, max_content_length=8))
    services = ServiceContainer(
        settings=settings,
        qa=FakeResearchQAService(),
    )
    client = TestClient(create_app(settings=settings, services=services))

    response = client.post("/api/query", json={"query": "This is too large"})

    assert response.status_code == 413
    assert response.json() == {"error": "Request body is too large"}
