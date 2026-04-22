"""
Image Recognition Module for Medical Procedures
Uses a Groq-hosted vision model to understand medical images, then
searches the procedures database with the generated description or answer.

Pipeline:
  1. Send image (+ optional question) to Groq vision chat completions
  2. Generate grounded structured injury understanding
  3. Convert structured findings into a focused retrieval query
  4. Return best matching procedures with video timestamps
"""

import base64
import contextlib
import io
import json
import re
from typing import Any

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
        "You are a medical image understanding assistant for first-aid retrieval. "
        "Look only at the selected visible region and identify the most likely visible body part, "
        "the visible injury type, its apparent severity, and the first-aid topic that should be searched. "
        "Do not infer unrelated problems outside the selected region. "
        "Return JSON only with keys: body_part, visible_injury, severity, first_aid_topic, summary. "
        "Use short factual values. If uncertain, say unknown."
    )
    QUESTION_PROMPT = (
        "You are a medical image understanding assistant for first-aid retrieval. "
        "Use the selected visible region plus the user's question to identify the most relevant visible injury "
        "and the first-aid topic that should be searched. "
        "Do not infer unrelated conditions outside the selected region. "
        "Return JSON only with keys: body_part, visible_injury, severity, first_aid_topic, summary, question_answer_focus. "
        "Use short factual values. If uncertain, say unknown."
    )
    FILLER_PATTERNS = (
        r"\bthis appears to be\b",
        r"\bappears to be\b",
        r"\bpossibly\b",
        r"\bmay be\b",
        r"\bmight be\b",
        r"\blikely\b",
        r"\bseems to be\b",
        r"\blooks like\b",
        r"\bthe image shows\b",
        r"\bthe selected region shows\b",
    )
    MEDICAL_KEYWORDS = (
        "bleeding",
        "burn",
        "fracture",
        "broken",
        "sprain",
        "strain",
        "laceration",
        "cut",
        "abrasion",
        "scrape",
        "wound",
        "rash",
        "bruise",
        "swelling",
        "infection",
        "choking",
        "cardiac arrest",
        "cpr",
        "chest pain",
        "heart attack",
        "dislocation",
    )

    def __init__(self, config, database, retriever=None):
        self.config = config
        self.retriever = retriever
        self.database = database

    @staticmethod
    def _clean_field(value: str | None) -> str:
        if not value:
            return "unknown"
        cleaned = str(value).strip().strip(".").lower()
        return cleaned or "unknown"

    @classmethod
    def _parse_response(cls, raw: str):
        """Extract structured hints from JSON-like or free-form model output."""
        result = {
            "body_part": "unknown",
            "condition": "unknown",
            "severity": "unknown",
            "description": raw.strip(),
            "search_query": "",
            "first_aid_topic": "unknown",
        }

        raw = raw.strip()

        with contextlib.suppress(Exception):
            parsed_json = json.loads(raw)
            body_part = cls._clean_field(parsed_json.get("body_part"))
            condition = cls._clean_field(parsed_json.get("visible_injury"))
            severity = cls._clean_field(parsed_json.get("severity"))
            first_aid_topic = cls._clean_field(parsed_json.get("first_aid_topic"))
            summary = str(parsed_json.get("summary", "")).strip()

            result["body_part"] = body_part
            result["condition"] = condition
            result["severity"] = (
                "emergency"
                if severity in {"life-threatening", "critical", "severe"}
                else severity
            )
            result["first_aid_topic"] = first_aid_topic
            result["description"] = summary or raw
            result["search_query"] = cls._build_search_query(
                body_part=body_part,
                condition=condition,
                first_aid_topic=first_aid_topic,
                fallback=summary or raw,
            )
            return result

        body_match = re.search(
            r"\b(hand|finger|thumb|wrist|forearm|arm|elbow|shoulder|foot|toe|ankle|shin|leg|knee|chest|back|neck|head|eye|ear|face|mouth|abdomen|skin)\b",
            raw,
            flags=re.IGNORECASE,
        )
        condition_match = re.search(
            r"\b(fracture|broken bone|sprain|strain|burn|cut|laceration|abrasion|scrape|wound|bleeding|rash|bruise|swelling|infection|choking|cardiac arrest|burn wound|dislocation)\b",
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

        result["search_query"] = cls._build_search_query(
            body_part=result["body_part"],
            condition=result["condition"],
            first_aid_topic="unknown",
            fallback=raw.strip(),
        )

        return result

    @classmethod
    def _clean_query_text(cls, text: str | None) -> str:
        """Remove filler language and keep the query concise for retrieval."""
        if not text:
            return ""

        cleaned = text.lower()
        for pattern in cls.FILLER_PATTERNS:
            cleaned = re.sub(pattern, " ", cleaned, flags=re.IGNORECASE)

        cleaned = re.sub(r"[^a-z0-9\s-]", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    @classmethod
    def _extract_medical_terms(cls, *texts: str | None) -> list[str]:
        """Extract stable medical terms from one or more VLM outputs."""
        found_terms: list[str] = []
        haystack = " ".join(text for text in texts if text).lower()
        for keyword in cls.MEDICAL_KEYWORDS:
            if keyword in haystack and keyword not in found_terms:
                found_terms.append(keyword)
        return found_terms

    @classmethod
    def build_fused_search_plan(
        cls,
        global_analysis: dict[str, Any] | None,
        region_analysis: dict[str, Any] | None,
        question: str | None = None,
        include_region: bool = True,
    ) -> dict[str, Any]:
        """
        Fuse full-image and region-specific understanding into concise retrieval queries.
        Returns a final fused query plus optional region/global focused variants.
        """
        global_analysis = global_analysis or {}
        region_analysis = region_analysis or {}

        global_parsed = global_analysis.get("parsed") or {}
        region_parsed = region_analysis.get("parsed") or {}
        question_clean = cls._clean_query_text(question)

        global_query = cls._clean_query_text(global_parsed.get("search_query"))
        region_query = (
            cls._clean_query_text(region_parsed.get("search_query")) if include_region else ""
        )
        global_summary = cls._clean_query_text(global_parsed.get("description"))
        region_summary = (
            cls._clean_query_text(region_parsed.get("description")) if include_region else ""
        )

        medical_terms = cls._extract_medical_terms(
            global_query,
            region_query,
            global_summary,
            region_summary,
            question_clean,
            global_parsed.get("condition"),
            region_parsed.get("condition"),
            global_parsed.get("first_aid_topic"),
            region_parsed.get("first_aid_topic"),
        )

        token_sequence: list[str] = []
        for chunk in (
            question_clean,
            region_query,
            global_query,
            region_parsed.get("condition"),
            global_parsed.get("condition"),
            region_parsed.get("body_part"),
            global_parsed.get("body_part"),
            region_parsed.get("first_aid_topic"),
            global_parsed.get("first_aid_topic"),
        ):
            cleaned = cls._clean_query_text(chunk)
            if not cleaned:
                continue
            for token in cleaned.split():
                if token not in token_sequence:
                    token_sequence.append(token)

        for term in medical_terms:
            for token in term.split():
                if token not in token_sequence:
                    token_sequence.append(token)

        for tail_token in ("first", "aid", "treatment"):
            if tail_token not in token_sequence:
                token_sequence.append(tail_token)

        fused_query = " ".join(token_sequence[:14]).strip()
        if not fused_query:
            fused_query = (
                region_query
                or global_query
                or question_clean
                or cls._clean_query_text(region_analysis.get("analysis_text"))
                or cls._clean_query_text(global_analysis.get("analysis_text"))
            )

        return {
            "fused_query": fused_query,
            "global_query": global_query or global_summary,
            "region_query": region_query or region_summary,
            "medical_terms": medical_terms,
        }

    @staticmethod
    def _build_search_query(
        body_part: str,
        condition: str,
        first_aid_topic: str,
        fallback: str,
    ) -> str:
        body_part = body_part.lower()
        condition = condition.lower()
        first_aid_topic = first_aid_topic.lower()

        if first_aid_topic not in {"", "unknown", "none", "n/a"}:
            return first_aid_topic
        if condition in {"cut", "laceration", "abrasion", "scrape", "wound"}:
            return f"How to clean and bandage a {body_part} {condition}"
        if condition == "bleeding":
            return f"How to stop bleeding from a {body_part} wound"
        if condition == "burn":
            return f"First aid for a {body_part} burn"
        if condition in {"fracture", "broken bone"}:
            return f"How to splint a fractured {body_part}"
        if condition in {"sprain", "strain"}:
            return f"How to support a sprained {body_part}"
        if body_part != "unknown" and condition != "unknown":
            return f"First aid treatment for {condition} on the {body_part}"
        return fallback

    def _search_procedures(self, query):
        """Search procedure database using the text embedding model."""
        if self.retriever:
            return self.retriever.search(query)
        return []

    @staticmethod
    def crop_to_bbox(
        image: Image.Image,
        bounding_box: tuple[int, int, int, int],
        padding_ratio: float = 0.12,
    ) -> Image.Image:
        """Crop around a SAM bbox with a small margin so context is preserved."""
        image = image.convert("RGB")
        width, height = image.size
        x_min, y_min, x_max, y_max = bounding_box

        box_width = max(x_max - x_min, 1)
        box_height = max(y_max - y_min, 1)
        pad_x = max(int(box_width * padding_ratio), 8)
        pad_y = max(int(box_height * padding_ratio), 8)

        left = max(x_min - pad_x, 0)
        top = max(y_min - pad_y, 0)
        right = min(x_max + pad_x, width)
        bottom = min(y_max + pad_y, height)

        return image.crop((left, top, right, bottom))

    def analyze_segmented_region(
        self,
        image: Image.Image,
        bounding_box: tuple[int, int, int, int],
        question: str | None = None,
    ) -> dict:
        """
        Run VLM understanding on the cropped segmentation region first,
        then return both the raw text and parsed retrieval hints.
        """
        cropped_image = self.crop_to_bbox(image, bounding_box)
        analysis_text = self.analyze_image(cropped_image, question=question)
        parsed = self._parse_response(analysis_text)
        return {
            "analysis_text": analysis_text,
            "parsed": parsed,
            "cropped_image": cropped_image,
        }

    @staticmethod
    def region_is_too_small(
        image_size: tuple[int, int],
        bounding_box: tuple[int, int, int, int],
        min_area_ratio: float = 0.02,
    ) -> bool:
        """Detect tiny regions that are likely too weak to drive retrieval alone."""
        width, height = image_size
        image_area = max(width * height, 1)
        x_min, y_min, x_max, y_max = bounding_box
        region_area = max(x_max - x_min, 1) * max(y_max - y_min, 1)
        return (region_area / image_area) < min_area_ratio

    @staticmethod
    def _build_action_query(body_part, condition):
        """Build a direct action query based on the condition type."""
        bp = body_part.lower()
        cond = condition.lower()

        if any(kw in cond for kw in ["fracture", "broken", "break", "crack"]):
            return f"How to splint a fractured {bp}"
        if any(kw in cond for kw in ["sprain", "strain"]):
            return f"How to tape or wrap a sprained {bp}"
        if any(kw in cond for kw in ["wound", "cut", "laceration", "abrasion", "scrape"]):
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
        first_aid_topic = analysis.get("first_aid_topic", "unknown")

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
        fallback_query = (
            first_aid_topic
            if first_aid_topic not in {"unknown", "", "none"}
            else f"{condition} {body_part} first aid treatment"
        )
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
            "first_aid_topic": first_aid_topic,
        }
