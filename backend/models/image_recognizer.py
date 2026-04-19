"""
Image Recognition Module for Medical Procedures
Uses a Groq-hosted vision model to understand medical images, then
searches the procedures database with the generated description or answer.

Pipeline:
  1. Send image (+ optional question) to Groq vision chat completions
  2. Generate a grounded description or answer
  3. Use that text as a query -> search procedure database
  4. Return best matching procedures with video timestamps
"""

import base64
import contextlib
import io
import re

import requests
from PIL import Image

from backend.models.llm import get_groq_chat_api_key


class MedicalImageRecognizer:
    """
    VLM-based medical image understanding using a Groq-hosted vision model.
    It produces textual understanding first, then uses Qdrant text search.
    """

    VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
    GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
    DESCRIPTION_PROMPT = (
        "You are a medical image understanding assistant. "
        "Describe the visible body part, probable condition or injury, severity, "
        "and the kind of first-aid or procedure help the user likely needs. "
        "Keep the answer very concise, factual, and useful for retrieving a medical procedure video. "
        "Use 2-4 short sentences maximum."
    )
    QUESTION_PROMPT = (
        "You are a medical image understanding assistant. "
        "Answer the user's question using the image. "
        "Include the visible condition or body part and the procedure or first-aid topic "
        "that should be searched for in a medical video database. "
        "Use 2-4 short sentences maximum."
    )

    def __init__(self, config, database, retriever=None):
        self.config = config
        self.retriever = retriever
        self.database = database

    @staticmethod
    def _parse_response(raw: str):
        """Extract structured hints from the generated text."""
        result = {
            "body_part": "unknown",
            "condition": "unknown",
            "severity": "unknown",
            "description": raw.strip(),
            "search_query": "",
        }

        body_match = re.search(
            r"\b(hand|finger|thumb|wrist|arm|elbow|shoulder|foot|toe|ankle|leg|knee|chest|back|neck|head|eye|ear|face|mouth|abdomen|skin)\b",
            raw,
            flags=re.IGNORECASE,
        )
        condition_match = re.search(
            r"\b(fracture|broken bone|sprain|strain|burn|cut|laceration|wound|bleeding|rash|bruise|swelling|infection|choking|cardiac arrest|burn wound|dislocation)\b",
            raw,
            flags=re.IGNORECASE,
        )
        severity_match = re.search(
            r"\b(emergency|serious|moderate|minor|severe|life-threatening)\b",
            raw,
            flags=re.IGNORECASE,
        )

        if body_match:
            result["body_part"] = body_match.group(1).lower()
        if condition_match:
            result["condition"] = condition_match.group(1).lower()
        if severity_match:
            value = severity_match.group(1).lower()
            result["severity"] = "emergency" if value in {"severe", "life-threatening"} else value

        if result["condition"] != "unknown" or result["body_part"] != "unknown":
            result["search_query"] = (
                f"How to treat {result['condition']} on the {result['body_part']}"
            )
        else:
            result["search_query"] = raw.strip()

        return result

    def _search_procedures(self, query):
        """Search procedure database using the text embedding model."""
        if self.retriever:
            return self.retriever.search(query)
        return []

    @staticmethod
    def _build_action_query(body_part, condition):
        """Build a direct action query based on the condition type."""
        bp = body_part.lower()
        cond = condition.lower()

        if any(kw in cond for kw in ["fracture", "broken", "break", "crack"]):
            return f"How to splint a fractured {bp}"
        if any(kw in cond for kw in ["sprain", "strain"]):
            return f"How to tape or wrap a sprained {bp}"
        if any(kw in cond for kw in ["wound", "cut", "laceration"]):
            return f"How to bandage a {bp} wound"
        if any(kw in cond for kw in ["burn"]):
            return f"First aid for {bp} burn"
        if any(kw in cond for kw in ["bleeding"]):
            return f"How to stop bleeding on the {bp}"
        if any(kw in cond for kw in ["dislocation", "dislocated"]):
            return f"First aid for dislocated {bp}"
        if any(kw in cond for kw in ["cardiac", "heart attack", "cpr"]):
            return "How to perform CPR cardiac arrest"
        if any(kw in cond for kw in ["choking"]):
            return "How to help a choking person Heimlich maneuver"
        return f"First aid treatment for {cond} on {bp}"

    def recognize_from_bytes(self, image_bytes, question: str | None = None):
        """Convenience wrapper for request handlers that receive raw uploads."""
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return self.recognize_from_image(image, question=question)

    @staticmethod
    def _prepare_image(image: Image.Image) -> Image.Image:
        """Downscale large uploads so vision requests stay lightweight."""
        prepared = image.convert("RGB")
        max_dimension = 768
        if max(prepared.size) > max_dimension:
            prepared.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
        return prepared

    @staticmethod
    def _image_to_data_url(image: Image.Image) -> str:
        """Encode a PIL image into a JPEG data URL for Groq vision input."""
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=90)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    def _get_groq_headers(self) -> dict[str, str]:
        """Build Groq authorization headers from config/env."""
        api_key = get_groq_chat_api_key(self.config)
        if not api_key:
            raise RuntimeError("Groq API key not configured. Add GROQ_API_KEY or ai.groq.api_key.")

        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def analyze_image(self, image, question: str | None = None) -> str:
        """Generate a description or answer from an image using Groq vision."""
        image = self._prepare_image(image)
        image_url = self._image_to_data_url(image)
        prompt = self.QUESTION_PROMPT if question else self.DESCRIPTION_PROMPT
        user_text = f"{prompt}\n\nUser question: {question}" if question else prompt

        payload = {
            "model": self.VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                }
            ],
            "temperature": 0.2,
            "max_tokens": 180,
        }

        response = requests.post(
            self.GROQ_CHAT_URL,
            headers=self._get_groq_headers(),
            json=payload,
            timeout=90,
        )
        if response.status_code != 200:
            error_detail = response.text
            with contextlib.suppress(Exception):
                error_detail = response.json().get("error", {}).get("message", error_detail)
            raise RuntimeError(
                f"Groq vision request failed: {response.status_code} - {error_detail}"
            )

        result = response.json()
        output_text = result["choices"][0]["message"]["content"]
        return output_text.strip()

    def recognize_from_image(
        self,
        image,
        question: str | None = None,
        analysis_text: str | None = None,
    ):
        """
        Analyze the image with Groq vision, then search Qdrant using the generated text.
        """
        image = self._prepare_image(image)
        if analysis_text is None:
            analysis_text = self.analyze_image(image, question=question)
        analysis = self._parse_response(analysis_text)

        body_part = analysis["body_part"]
        condition = analysis["condition"]
        severity = analysis["severity"]
        search_query = analysis["search_query"]

        is_emergency = severity == "emergency" or any(
            kw in condition.lower()
            for kw in [
                "cardiac",
                "heart attack",
                "choking",
                "unconscious",
                "cpr",
                "not breathing",
                "severe bleeding",
            ]
        )

        sims_main = self._search_procedures(search_query)
        fallback_query = f"{condition} {body_part} first aid treatment"
        sims_fallback = self._search_procedures(fallback_query)
        action_query = self._build_action_query(body_part, condition)
        sims_action = self._search_procedures(action_query)

        top_k = self.config.get("vision", {}).get("top_k_matches", 5)
        weighted_results = []
        if sims_main:
            weighted_results.append((sims_main, 0.4))
        if sims_action:
            weighted_results.append((sims_action, 0.3))
        if sims_fallback:
            weighted_results.append((sims_fallback, 0.3))

        if weighted_results:
            merged_scores = {}
            for results, weight in weighted_results:
                for result in results:
                    key = result.get("question", "").lower()
                    if key not in merged_scores:
                        merged_scores[key] = result.copy()
                        merged_scores[key]["similarity_score"] = 0.0
                    merged_scores[key]["similarity_score"] += weight * result.get(
                        "similarity_score", 0.0
                    )
            results = sorted(
                merged_scores.values(),
                key=lambda item: item["similarity_score"],
                reverse=True,
            )[:top_k]
        else:
            results = []

        for result in results:
            result["confidence"] = float(result.get("similarity_score", 0.0)) * 100
            result["title"] = result.get("question", result.get("description", "Image match"))
            if result.get("video_id") and not result.get("video_url"):
                result["video_url"] = f"https://www.youtube.com/watch?v={result['video_id']}"

        return {
            "success": True,
            "top_match": results[0] if results else None,
            "all_matches": results,
            "recognition_method": f"{self.VISION_MODEL} via Groq + Qdrant text retrieval",
            "is_emergency": is_emergency,
            "detected_body_part": body_part,
            "detected_condition": condition,
            "detected_severity": severity,
            "description": analysis_text,
            "search_query": search_query,
        }
