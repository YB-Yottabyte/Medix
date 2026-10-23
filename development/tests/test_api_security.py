"""Deployment boundary tests without model downloads or external services."""

import asyncio

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from httpx2 import ASGITransport, AsyncClient

from backend.api.security import ApiSecurityMiddleware


def application(token="", maximum=32):
    app = FastAPI()
    app.add_middleware(ApiSecurityMiddleware, maximum=maximum, token=token)

    @app.post("/api/echo")
    async def echo(request: Request):
        return {"size": len(await request.body())}

    @app.get("/api/ready")
    async def ready():
        return {"ready": True}

    @app.get("/api/artifacts/{path:path}")
    async def artifact(path: str):
        return {"path": path}

    return app


def test_optional_auth_keeps_local_development_working():
    client = TestClient(application())
    assert client.post("/api/echo", content=b"hello").json() == {"size": 5}


def test_token_protects_inference_and_artifacts_but_not_probes():
    client = TestClient(application(token="test-token"))
    assert client.post("/api/echo", content=b"hello").status_code == 401
    assert client.get("/api/artifacts/clip.mp4").status_code == 401
    assert client.get("/api/ready").status_code == 200
    assert (
        client.post(
            "/api/echo", content=b"hello", headers={"Authorization": "Bearer test-token"}
        ).status_code
        == 200
    )
    response = client.post("/api/echo", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401
    assert "test-token" not in response.text


def test_content_length_and_chunked_bodies_share_the_same_limit():
    client = TestClient(application(maximum=8))
    assert client.post("/api/echo", content=b"a" * 9).status_code == 413

    async def run():
        async def chunks():
            yield b"12345"
            yield b"6789"

        async with AsyncClient(
            transport=ASGITransport(app=application(maximum=8)), base_url="http://test"
        ) as client:
            response = await client.post("/api/echo", content=chunks())
            assert response.status_code == 413
            assert response.json() == {"error": "Request body is too large"}

    asyncio.run(run())


def test_malformed_content_length_does_not_reach_the_handler():
    client = TestClient(application())
    assert client.post("/api/echo", headers={"content-length": "invalid"}).status_code == 400


def test_readiness_distinguishes_degraded_startup_without_leaking_diagnostics(monkeypatch):
    from backend.application import create_app
    from backend.config import AppSettings
    from backend.container import ServiceContainer

    monkeypatch.setenv("MEDIX_API_TOKEN", "test-only")
    settings = AppSettings.safe_defaults()
    services = ServiceContainer.unavailable(settings, "private startup details")
    client = TestClient(create_app(settings=settings, services=services))
    assert client.get("/api/health").status_code == 200
    response = client.get("/api/ready")
    assert response.status_code == 503
    assert response.json() == {"ready": False}
    assert "private" not in response.text
    assert client.post("/api/query", json={"query": "a question"}).status_code == 401
