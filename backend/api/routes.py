"""FastAPI routes that translate HTTP requests to Medix use cases."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from backend.container import ServiceContainer
from backend.errors import ServiceUnavailableError, ValidationError
from backend.services.grounded_qa import GroundedMedicalQAPipeline
from backend.services.kokoro_tts import (
    KokoroSpeechSynthesizer,
    KokoroUnavailableError,
    get_kokoro_synthesizer,
)

router = APIRouter(prefix="/api", tags=["Medix"])


class QueryRequest(BaseModel):
    """A non-empty question for the canonical evidence-grounded pipeline."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=2_000)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("query must not be empty")
        return normalized


class SpeechRequest(BaseModel):
    """A short response chunk to synthesize with local Kokoro."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=200)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("text must not be empty")
        return normalized


class CitationResponse(BaseModel):
    """A citation with source-video and extracted-clip timestamp coordinates."""

    cue_id: str
    start_seconds: float
    end_seconds: float
    clip_start_seconds: float
    clip_end_seconds: float
    text: str


class QueryResponse(BaseModel):
    """Stable HTTP contract for the complete canonical prediction."""

    pipeline: str = "canonical-medix"
    query: str
    status: str
    response: str
    video_id: str | None
    video_url: str | None
    clip_url: str | None
    start_seconds: float | None
    end_seconds: float | None
    confidence: float | None
    safety_disposition: str
    safety_warning: str | None
    citations: list[CitationResponse]
    evidence_context: list[CitationResponse]
    evidence_bundle_id: str | None
    abstention_reason: str | None


def get_container(request: Request) -> ServiceContainer:
    """Return the application-scoped dependency container."""
    return request.app.state.medix_services


def get_qa(
    container: Annotated[ServiceContainer, Depends(get_container)],
) -> GroundedMedicalQAPipeline:
    """Return the canonical service only when enabled and initialized."""
    if not container.settings.research.enabled:
        raise ServiceUnavailableError(
            "The research pipeline is disabled. Set research_pipeline.enabled to true."
        )
    if not container.ready or container.qa is None:
        raise ServiceUnavailableError(
            container.startup_error or "The canonical pipeline is not initialized."
        )
    return container.qa


ContainerDependency = Annotated[ServiceContainer, Depends(get_container)]
QAServiceDependency = Annotated[
    GroundedMedicalQAPipeline,
    Depends(get_qa),
]
SpeechServiceDependency = Annotated[
    KokoroSpeechSynthesizer,
    Depends(get_kokoro_synthesizer),
]


@router.post(
    "/tts",
    response_class=Response,
    responses={200: {"content": {"audio/wav": {}}}},
    summary="Synthesize response speech locally with Kokoro",
)
async def text_to_speech(
    payload: SpeechRequest,
    synthesizer: SpeechServiceDependency,
) -> Response:
    try:
        wav_audio = await run_in_threadpool(synthesizer.synthesize, payload.text)
    except KokoroUnavailableError as exc:
        raise ServiceUnavailableError(str(exc)) from exc
    return Response(
        content=wav_audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@router.post(
    "/query",
    response_model=QueryResponse,
    summary="Run the canonical evidence-grounded Medix pipeline",
)
async def query(
    payload: QueryRequest,
    request: Request,
    qa: QAServiceDependency,
) -> QueryResponse:
    return await _run_query(payload, request, qa)


@router.post(
    "/v2/query",
    response_model=QueryResponse,
    summary="Compatibility alias for the canonical Medix query endpoint",
)
async def v2_query(
    payload: QueryRequest,
    request: Request,
    qa: QAServiceDependency,
) -> QueryResponse:
    return await _run_query(payload, request, qa)


async def _run_query(
    payload: QueryRequest,
    request: Request,
    qa: GroundedMedicalQAPipeline,
) -> QueryResponse:
    result = await run_in_threadpool(qa.run, payload.query)
    answer = result.answer
    clip_url = None
    if answer.clip_artifact_path:
        clip_url = str(
            request.url_for(
                "canonical_artifact",
                artifact_path=answer.clip_artifact_path,
            )
        )
    clip_start = answer.clip_start_seconds or 0.0
    clip_end = answer.clip_end_seconds or clip_start
    citations = [
        _citation_response(
            cue_id=citation.cue_id,
            start_seconds=citation.start_seconds,
            end_seconds=citation.end_seconds,
            text=citation.text,
            clip_start_seconds=clip_start,
            clip_end_seconds=clip_end,
        )
        for citation in answer.citations
    ]
    evidence = result.evidence_result.evidence
    evidence_context = (
        [
            _citation_response(
                cue_id=f"T{index:03d}",
                start_seconds=cue.start_seconds,
                end_seconds=cue.end_seconds,
                text=cue.text,
                clip_start_seconds=clip_start,
                clip_end_seconds=clip_end,
            )
            for index, cue in enumerate(evidence.transcript, 1)
        ]
        if evidence is not None
        else list(citations)
    )
    return QueryResponse(
        query=answer.question,
        status=answer.status,
        response=answer.response,
        video_id=answer.video_id,
        video_url=answer.source_uri,
        clip_url=clip_url,
        start_seconds=answer.clip_start_seconds,
        end_seconds=answer.clip_end_seconds,
        confidence=result.evidence_result.joint_score,
        safety_disposition=result.safety_assessment.disposition,
        safety_warning=result.safety_assessment.warning,
        citations=citations,
        evidence_context=evidence_context,
        evidence_bundle_id=answer.evidence_bundle_id,
        abstention_reason=answer.abstention_reason,
    )


def _citation_response(
    *,
    cue_id: str,
    start_seconds: float,
    end_seconds: float,
    text: str,
    clip_start_seconds: float,
    clip_end_seconds: float,
) -> CitationResponse:
    """Map one source-video cue onto the extracted clip clock."""
    clip_duration = max(0.0, clip_end_seconds - clip_start_seconds)
    return CitationResponse(
        cue_id=cue_id,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
        clip_start_seconds=max(0.0, start_seconds - clip_start_seconds),
        clip_end_seconds=max(
            0.0,
            min(clip_duration, end_seconds - clip_start_seconds),
        ),
        text=text,
    )


@router.get(
    "/artifacts/{artifact_path:path}",
    name="canonical_artifact",
    response_class=FileResponse,
    summary="Read a canonical evidence artifact",
)
@router.get(
    "/v2/artifacts/{artifact_path:path}",
    name="research_artifact",
    response_class=FileResponse,
    summary="Compatibility alias for a canonical evidence artifact",
)
def research_artifact(
    artifact_path: str,
    request: Request,
    container: ContainerDependency,
) -> FileResponse:
    if not container.ready:
        raise ServiceUnavailableError("The canonical pipeline is not available.")
    root = Path(request.app.state.research_artifact_root).resolve()
    candidate = (root / artifact_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValidationError("Invalid research artifact path") from exc
    if not candidate.is_file():
        from backend.errors import ResourceNotFoundError

        raise ResourceNotFoundError("Research artifact not found")
    return FileResponse(candidate)


@router.get("/health", summary="Report service readiness")
def health(container: ContainerDependency) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "healthy" if container.ready else "degraded",
        "canonical_pipeline": {
            "enabled": container.settings.research.enabled,
            "ready": container.ready,
            "answer_model": container.settings.research.answer_model,
            "localizer_strategy": container.settings.research.localizer_strategy,
        },
    }
    if container.startup_error:
        payload["startup_error"] = container.startup_error
    return payload
