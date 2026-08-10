"""Application use cases for text, video, image, voice, and multimodal QA."""

from __future__ import annotations

import contextlib
import time
from typing import TYPE_CHECKING, Any

from backend.errors import ResourceNotFoundError, ServiceUnavailableError, ValidationError
from backend.services.pipeline import (
    EMERGENCY_WARNING,
    RESTRICTED_SCOPE_MESSAGE,
    RetrievalGate,
    SafetyTriageService,
)

if TYPE_CHECKING:
    from backend.config import AppSettings
    from backend.ports import (
        ImageRecognizerPort,
        LanguageModelPort,
        ResponseGeneratorPort,
        RetrieverPort,
        TranscriptionPort,
    )


class MedicalQAService:
    """Coordinate Medix domain components without depending on FastAPI."""

    def __init__(
        self,
        *,
        settings: AppSettings,
        response_generator: ResponseGeneratorPort,
        retriever: RetrieverPort,
        ai_handler: LanguageModelPort,
        image_recognizer: ImageRecognizerPort | None,
        transcription_service: TranscriptionPort,
    ):
        self.settings = settings
        self.response_generator = response_generator
        self.retriever = retriever
        self.ai_handler = ai_handler
        self.image_recognizer = image_recognizer
        self.transcription_service = transcription_service
        self.safety_triage = SafetyTriageService()
        self.retrieval_gate = RetrievalGate(settings.safety.answer_confidence_threshold)

    def answer_text(self, query: str) -> dict[str, Any]:
        normalized = self._require_query(query)
        safety = self.safety_triage.assess(normalized)
        if safety.disposition == "restricted":
            return self._restricted_response(normalized, safety.as_dict())

        response = self.response_generator.generate(normalized)
        response["safety"] = safety.as_dict()
        response["emergency_warning"] = safety.warning
        return response

    def answer_with_video(self, query: str) -> dict[str, Any]:
        response = self.answer_text(query)
        procedures = response["retrieved_procedures"]
        video = self._video_metadata(procedures[0] if procedures else None)
        return {
            **response,
            **video,
        }

    def analyze_image(self, image_bytes: bytes) -> dict[str, Any]:
        self._validate_image(image_bytes)
        recognition = self._recognize(image_bytes)
        if not recognition.get("success"):
            raise ServiceUnavailableError("Image recognition failed")

        top_match = recognition.get("top_match")
        if not top_match:
            raise ResourceNotFoundError("No matching procedures found")

        context_response = None
        if top_match.get("question"):
            with contextlib.suppress(Exception):
                context_response = self.response_generator.generate(top_match["question"])

        video_id = top_match.get("video_id")
        is_emergency = bool(recognition.get("is_emergency"))
        warning = (
            f"{EMERGENCY_WARNING} The guidance below is for educational purposes only and "
            "does not replace professional medical care."
            if is_emergency
            else None
        )
        return {
            "success": True,
            "recognition": {
                "top_match": top_match,
                "all_matches": recognition.get("all_matches", [])[:3],
                "method": recognition.get("recognition_method"),
                "detected_body_part": recognition.get("detected_body_part"),
                "detected_condition": recognition.get("detected_condition"),
                "detected_severity": recognition.get("detected_severity"),
                "description": recognition.get("description"),
                "search_query": recognition.get("search_query"),
            },
            "video_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
            "video_id": video_id,
            "answer_start": top_match.get("answer_start"),
            "answer_end": top_match.get("answer_end"),
            "title": top_match.get("title"),
            "question": top_match.get("question"),
            "confidence": top_match.get("confidence"),
            "ai_guidance": context_response.get("response") if context_response else None,
            "is_emergency": is_emergency,
            "emergency_warning": warning,
        }

    def transcribe(self, audio_bytes: bytes, filename: str) -> dict[str, Any]:
        text = self.transcription_service.transcribe(audio_bytes, filename)
        return {
            "success": True,
            "text": text,
            "method": self.transcription_service.MODEL,
        }

    def analyze_frame(self, image_bytes: bytes) -> dict[str, Any]:
        started = time.monotonic()
        self._validate_image(image_bytes)
        recognition = self._recognize(image_bytes)
        if not recognition.get("success"):
            raise ServiceUnavailableError("Frame analysis failed")

        top = recognition.get("top_match")
        return {
            "success": True,
            "body_part": recognition.get("detected_body_part"),
            "condition": recognition.get("detected_condition"),
            "severity": recognition.get("detected_severity"),
            "description": recognition.get("description"),
            "matched_procedure": top.get("question") if top else None,
            "video_id": top.get("video_id") if top else None,
            "answer_start": top.get("answer_start") if top else None,
            "answer_end": top.get("answer_end") if top else None,
            "confidence": top.get("confidence", 0) if top else 0,
            "is_emergency": bool(recognition.get("is_emergency")),
            "latency_ms": int((time.monotonic() - started) * 1000),
        }

    def answer_multimodal(
        self,
        *,
        text_query: str = "",
        image_bytes: bytes | None = None,
        audio_bytes: bytes | None = None,
        audio_filename: str = "audio.webm",
    ) -> dict[str, Any]:
        started = time.monotonic()
        query = text_query.strip()

        if audio_bytes:
            voice_text = self.transcription_service.transcribe(audio_bytes, audio_filename)
            query = f"{query} {voice_text}".strip()

        safety = self.safety_triage.assess(query)
        if safety.disposition == "restricted":
            return {
                "success": True,
                **self._restricted_response(query, safety.as_dict()),
                "visual_analysis": None,
                "latency_ms": int((time.monotonic() - started) * 1000),
                "pipeline": "multimodal-rag",
            }

        visual_context = None
        if image_bytes:
            self._validate_image(image_bytes)
            visual_context = self._recognize(image_bytes)

        if not query and not visual_context:
            raise ValidationError("No query, audio, or image provided")

        enriched_query = self._enrich_query(query, visual_context)
        retrieval_started = time.monotonic()
        retrieved = self._retrieve_multimodal(query, enriched_query, visual_context)
        retrieval_ms = int((time.monotonic() - retrieval_started) * 1000)
        retrieval = self.retrieval_gate.assess(retrieved)
        visual_emergency = bool(visual_context and visual_context.get("is_emergency"))
        is_emergency = safety.disposition == "emergency" or visual_emergency
        safety_payload = safety.as_dict()
        if visual_emergency and safety.disposition != "emergency":
            safety_payload = {
                "disposition": "emergency",
                "reason": "The visual analysis flagged potential emergency signs.",
                "warning": EMERGENCY_WARNING,
            }

        if not retrieval.answerable:
            return {
                "success": True,
                "query": query,
                "enriched_query": enriched_query,
                "response": (
                    "I could not find sufficiently relevant procedure evidence to "
                    "provide guidance safely."
                ),
                "status": "abstained",
                "answerable": False,
                "confidence": retrieval.confidence,
                "confidence_threshold": retrieval.threshold,
                "abstention_reason": retrieval.reason,
                "evidence": list(retrieval.evidence),
                "video_id": None,
                "video_url": None,
                "answer_start": None,
                "answer_end": None,
                "retrieved_procedures": retrieved,
                "visual_analysis": self._visual_summary(visual_context),
                "safety": safety_payload,
                "is_emergency": is_emergency,
                "emergency_warning": EMERGENCY_WARNING if is_emergency else None,
                "latency_ms": int((time.monotonic() - started) * 1000),
                "metrics": {
                    "retrieval_ms": retrieval_ms,
                    "generation_ms": 0,
                },
                "pipeline": "multimodal-rag",
            }

        context = self.retriever.format_results_for_context(retrieved)
        if visual_context and visual_context.get("success"):
            context += self._format_visual_context(visual_context)

        generation_query = query or (
            "Please give first-aid guidance based on the image findings and retrieved context."
        )
        generation_started = time.monotonic()
        response = self.ai_handler.generate_multimodal_response(generation_query, context)
        generation_ms = int((time.monotonic() - generation_started) * 1000)
        top = retrieved[0] if retrieved else {}
        video_id = top.get("video_id")

        return {
            "success": True,
            "query": query,
            "enriched_query": enriched_query,
            "response": response,
            "status": "answered",
            "answerable": True,
            "confidence": retrieval.confidence,
            "confidence_threshold": retrieval.threshold,
            "abstention_reason": None,
            "evidence": list(retrieval.evidence),
            "video_id": video_id,
            "video_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
            "answer_start": top.get("answer_start"),
            "answer_end": top.get("answer_end"),
            "retrieved_procedures": retrieved,
            "visual_analysis": self._visual_summary(visual_context),
            "safety": safety_payload,
            "is_emergency": is_emergency,
            "emergency_warning": EMERGENCY_WARNING if is_emergency else None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "metrics": {
                "retrieval_ms": retrieval_ms,
                "generation_ms": generation_ms,
            },
            "pipeline": "multimodal-rag",
        }

    def _recognize(self, image_bytes: bytes) -> dict[str, Any]:
        if self.image_recognizer is None:
            raise ServiceUnavailableError(
                "Vision service is unavailable. Configure a Groq API key to enable it."
            )
        return self.image_recognizer.recognize_from_bytes(image_bytes)

    def _validate_image(self, image_bytes: bytes) -> None:
        if not image_bytes:
            raise ValidationError("Empty image file")
        if len(image_bytes) > self.settings.vision.max_image_size:
            size_mb = self.settings.vision.max_image_size / 1024 / 1024
            raise ValidationError(f"Image file too large. Max size: {size_mb:g}MB")

    @staticmethod
    def _require_query(query: str) -> str:
        normalized = (query or "").strip()
        if not normalized:
            raise ValidationError("No query provided")
        return normalized

    @staticmethod
    def _restricted_response(
        query: str,
        safety: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "query": query,
            "response": RESTRICTED_SCOPE_MESSAGE,
            "status": "abstained",
            "answerable": False,
            "confidence": 0.0,
            "confidence_threshold": None,
            "abstention_reason": safety["reason"],
            "evidence": [],
            "retrieved_procedures": [],
            "num_procedures_found": 0,
            "safety": safety,
            "emergency_warning": safety.get("warning"),
            "metrics": {
                "retrieval_ms": 0,
                "generation_ms": 0,
                "total_ms": 0,
            },
        }

    @staticmethod
    def _video_metadata(procedure: dict[str, Any] | None) -> dict[str, Any]:
        if not procedure:
            return {
                "video_url": None,
                "video_id": None,
                "answer_start": None,
                "answer_end": None,
                "video_steps": [],
            }

        video_url = procedure.get("youtube_embed") or procedure.get("youtube_url")
        answer_start = procedure.get("answer_start")
        answer_end = procedure.get("answer_end")
        return {
            "video_url": video_url,
            "video_id": procedure.get("video_id"),
            "answer_start": int(answer_start) if answer_start is not None else None,
            "answer_end": int(answer_end) if answer_end is not None else None,
            "video_steps": [
                {
                    "time": step.get("absolute_bounds", [0])[0],
                    "description": step.get("heading", "Step"),
                }
                for step in procedure.get("steps", [])
            ],
        }

    @staticmethod
    def _enrich_query(query: str, visual: dict[str, Any] | None) -> str:
        if not visual or not visual.get("success"):
            return query
        description = (
            f"The image shows {visual.get('detected_condition', 'a condition')} "
            f"on the {visual.get('detected_body_part', 'body')}. "
            f"{visual.get('description', '')}"
        )
        return (
            f"{query}. Visual context: {description}"
            if query
            else visual.get("search_query") or description
        )

    def _retrieve_multimodal(
        self,
        query: str,
        enriched_query: str,
        visual: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        if visual and visual.get("success"):
            return self.retriever.search_with_context(
                enriched_query,
                body_part=visual.get("detected_body_part"),
                condition=visual.get("detected_condition"),
            )

        queries = [enriched_query]
        weights = [0.6]
        if query and query != enriched_query:
            queries.append(query)
            weights.append(0.2)
        return self.retriever.multi_query_search(queries, weights)

    @staticmethod
    def _format_visual_context(visual: dict[str, Any]) -> str:
        return (
            "\n\nVISUAL FINDINGS (from uploaded image):\n"
            f"- Body part: {visual.get('detected_body_part', 'unknown')}\n"
            f"- Condition: {visual.get('detected_condition', 'unknown')}\n"
            f"- Severity: {visual.get('detected_severity', 'unknown')}\n"
            f"- Description: {visual.get('description', '')}\n"
            "Use these visual findings together with the user's question and transcript context."
        )

    @staticmethod
    def _visual_summary(visual: dict[str, Any] | None) -> dict[str, Any] | None:
        if not visual:
            return None
        return {
            "body_part": visual.get("detected_body_part"),
            "condition": visual.get("detected_condition"),
            "severity": visual.get("detected_severity"),
            "description": visual.get("description"),
        }
