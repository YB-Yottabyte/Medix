"""ASGI request limits and optional server-to-server authentication."""

from __future__ import annotations

import hmac
from typing import TYPE_CHECKING

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ApiSecurityMiddleware:
    """Reject oversized bodies before parsing, including chunked requests.

    A configured token protects API calls and artifacts. It is never sent to a
    browser. Health/readiness probes remain public for hosting platforms.
    """

    def __init__(self, app: ASGIApp, *, maximum: int, token: str = "") -> None:
        self.app = app
        self.maximum = maximum
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        protected = scope["path"].startswith("/api/") and scope["path"] not in {
            "/api/health",
            "/api/ready",
        }
        if self.token and protected:
            supplied = headers.get("authorization", "")
            if not hmac.compare_digest(supplied.encode(), f"Bearer {self.token}".encode()):
                await JSONResponse({"error": "Unauthorized"}, status_code=401)(scope, receive, send)
                return
        length = headers.get("content-length")
        if length is not None and not length.isdecimal():
            await JSONResponse({"error": "Invalid Content-Length"}, status_code=400)(
                scope, receive, send
            )
            return
        if length is not None and int(length) > self.maximum:
            await JSONResponse({"error": "Request body is too large"}, status_code=413)(
                scope, receive, send
            )
            return
        if scope["method"] not in {"POST", "PUT", "PATCH", "DELETE"}:
            await self.app(scope, receive, send)
            return
        messages: list[Message] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > self.maximum:
                await JSONResponse({"error": "Request body is too large"}, status_code=413)(
                    scope, receive, send
                )
                return
            messages.append(message)
            if not message.get("more_body", False):
                break
        buffered = iter(messages)

        async def replay() -> Message:
            try:
                return next(buffered)
            except StopIteration:
                return await receive()

        await self.app(scope, replay, send)
