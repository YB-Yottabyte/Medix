"""
Image Recognition Module for Medical Procedures
Uses a configured vision-language model via the Groq API to describe
medical images, then searches the procedures database with the description.

Pipeline:
  1. Send image to the configured VLM → get a detailed medical description
  2. Use that description as a text query → search procedure database
  3. Return best matching procedures with video timestamps
"""

import base64
import io

import numpy as np
from groq import Groq
from PIL import Image

from backend.adapters.language_model import get_groq_chat_api_key


class MedicalImageRecognizer:
    """VLM-based medical image recognition using a configured Groq model."""

    SYSTEM_PROMPT = (
        "You are a medical image analysis assistant. "
        "Analyze the image and provide a structured medical assessment. "
        "You MUST respond in EXACTLY this format (no extra text):\n\n"
        "BODY_PART: <specific body part shown, e.g. hand, foot, chest, arm>\n"
        "CONDITION: <medical condition visible, e.g. fracture, wound, burn, sprain>\n"
        "SEVERITY: <emergency / serious / moderate / minor>\n"
        "DESCRIPTION: <one sentence clinical description>\n"
        "SEARCH_QUERY: <a short search query to find a first-aid treatment video, "
        "e.g. 'How to splint a fractured hand'>\n\n"
        "Focus on what is visually evident. Be specific about the body part "
        "and the type of injury or condition."
    )

    def __init__(self, config, database):
        self.config = config
        self.database = database
        self.model = config.get("vision", {}).get("model")
        if not self.model:
            raise ValueError("Vision model not configured at vision.model")

        api_key = get_groq_chat_api_key(config)
        if not api_key:
            raise ValueError("Groq API key not found in config")

        self.client = Groq(api_key=api_key)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _image_to_base64(image):
        """Convert PIL Image to base64 data URI."""
        buf = io.BytesIO()
        # Resize if too large (Groq has payload limits)
        max_dim = 1024
        if max(image.size) > max_dim:
            image.thumbnail((max_dim, max_dim), Image.LANCZOS)
        image.save(buf, format="JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/jpeg;base64,{b64}"

    # Vision Langauge Model analysis: send image, get structured medical description

    def _analyze_image(self, image):
        """Send an image to the configured VLM and parse its analysis."""
        data_uri = self._image_to_base64(image)

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": self.SYSTEM_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_uri}},
                    ],
                }
            ],
            max_tokens=300,
            temperature=0.1,
        )

        raw = response.choices[0].message.content.strip()
        return self._parse_response(raw)

    @staticmethod
    def _parse_response(raw):
        """Parse the structured VLM response into a dict."""
        result = {
            "body_part": "unknown",
            "condition": "unknown",
            "severity": "unknown",
            "description": "",
            "search_query": "",
        }

        for line in raw.split("\n"):
            line = line.strip()
            if not line or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip().lower().replace(" ", "_")
            value = value.strip()

            if key == "body_part":
                result["body_part"] = value
            elif key == "condition":
                result["condition"] = value
            elif key == "severity":
                result["severity"] = value.lower()
            elif key == "description":
                result["description"] = value
            elif key == "search_query":
                result["search_query"] = value.strip("'\"")

        # Fallback: if search_query is empty, build one
        if not result["search_query"]:
            result["search_query"] = (
                f"How to treat {result['condition']} on the {result['body_part']}"
            )

        return result

    def _search_procedures(self, query):
        """Search procedure database using the text embedding model."""
        query_embedding = self.database.embedding_model.encode([query])[0]

        similarities = []
        for proc_embedding in self.database.embeddings:
            sim = float(
                np.dot(query_embedding, proc_embedding)
                / (np.linalg.norm(query_embedding) * np.linalg.norm(proc_embedding))
            )
            similarities.append(sim)

        return np.array(similarities)

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

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------
    def recognize_from_bytes(self, image_bytes):
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return self.recognize_from_image(image)

    def recognize_from_image(self, image):
        """
        Main entry point.
        1. The configured VLM analyses the image → structured medical description
        2. Use the description as a search query → find matching procedures
        3. Return ranked results
        """

        # --- Stage 1: VLM analysis ---
        analysis = self._analyze_image(image)

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

        # Stage 2: search procedures with MULTIPLE queries
        # Query 1: VLM-generated query
        sims_main = self._search_procedures(search_query)

        # Query 2: Simple condition + body part
        fallback_query = f"{condition} {body_part} first aid treatment"
        sims_fallback = self._search_procedures(fallback_query)

        # Query 3: Direct action query targeting the procedure type
        action_query = self._build_action_query(body_part, condition)
        sims_action = self._search_procedures(action_query)

        # Combine: 40% main + 30% action + 30% fallback
        similarities = 0.4 * sims_main + 0.3 * sims_action + 0.3 * sims_fallback

        # --- Condition-based boost / penalty ---
        cond_lower = condition.lower()
        for i, proc in enumerate(self.database.procedures):
            q = proc["question"].lower()

            # If VLM detected a FRACTURE / BREAK
            if any(kw in cond_lower for kw in ["fracture", "broken", "break", "crack"]):
                if any(
                    kw in q
                    for kw in ["fracture", "splint", "broken", "break", "first aid", "bandage"]
                ):
                    similarities[i] *= 2.0  # strong boost for fracture treatment
                elif any(
                    kw in q
                    for kw in [
                        "exercise",
                        "stretch",
                        "flex",
                        "massage",
                        "strengthen",
                        "yoga",
                        "workout",
                    ]
                ):
                    similarities[i] *= 0.3  # heavy penalty for exercises

            # If VLM detected a SPRAIN / STRAIN
            elif any(kw in cond_lower for kw in ["sprain", "strain", "ligament"]):
                if any(kw in q for kw in ["sprain", "strain", "tape", "wrap", "bandage", "brace"]):
                    similarities[i] *= 1.8
                elif any(kw in q for kw in ["fracture", "splint", "broken"]):
                    similarities[i] *= 0.5

            # If VLM detected a WOUND / CUT / BLEEDING
            elif any(kw in cond_lower for kw in ["wound", "cut", "laceration", "bleeding"]):
                if any(
                    kw in q for kw in ["wound", "cut", "bandage", "bleeding", "first aid", "stitch"]
                ):
                    similarities[i] *= 1.8
                elif any(kw in q for kw in ["exercise", "stretch", "massage"]):
                    similarities[i] *= 0.3

            # If VLM detected a BURN
            elif "burn" in cond_lower:
                if "burn" in q:
                    similarities[i] *= 2.0
                elif any(kw in q for kw in ["exercise", "stretch", "massage"]):
                    similarities[i] *= 0.3

        # Body-part based boost / penalty ---
        bp_lower = body_part.lower()
        body_groups = {
            "hand": {"hand", "finger", "thumb", "wrist", "palm", "knuckle"},
            "foot": {"foot", "toe", "ankle", "heel", "sesamoid", "plantar"},
            "arm": {"arm", "elbow", "forearm", "bicep", "tricep"},
            "leg": {"leg", "knee", "shin", "thigh", "calf", "quadricep"},
            "chest": {"chest", "rib", "sternum", "thorax", "heart", "cardiac"},
            "head": {"head", "skull", "face", "jaw", "temple"},
            "back": {"back", "spine", "lumbar", "vertebra", "spinal"},
            "neck": {"neck", "cervical"},
            "shoulder": {"shoulder", "rotator", "clavicle"},
        }

        detected_group = None
        for _group_name, words in body_groups.items():
            if bp_lower in words or any(w in bp_lower for w in words):
                detected_group = words
                break

        if detected_group is not None:
            wrong_groups = [g for g in body_groups.values() if g is not detected_group]
            for i, proc in enumerate(self.database.procedures):
                proc_words = set(proc["question"].lower().split())
                if proc_words & detected_group:
                    similarities[i] *= 1.3  # boost matching body part
                for wg in wrong_groups:
                    if proc_words & wg:
                        similarities[i] *= 0.5  # penalise wrong body part
                        break

        # --- Build results ---
        top_k = self.config.get("vision", {}).get("top_k_matches", 5)
        top_indices = np.argsort(similarities)[::-1][:top_k]

        results = []
        for idx in top_indices:
            proc = self.database.procedures[idx]
            results.append(
                {
                    "procedure_index": int(idx),
                    "title": proc["question"],
                    "question": proc["question"],
                    "video_id": proc["video_id"],
                    "video_url": f"https://www.youtube.com/watch?v={proc['video_id']}",
                    "answer_start": proc.get("answer_start", 0),
                    "answer_end": proc.get("answer_end", 0),
                    "similarity_score": float(similarities[idx]),
                    "confidence": float(similarities[idx]) * 100,
                }
            )

        return {
            "success": True,
            "top_match": results[0] if results else None,
            "all_matches": results,
            "recognition_method": f"{self.model} VLM",
            "is_emergency": is_emergency,
            "detected_body_part": body_part,
            "detected_condition": condition,
            "detected_severity": severity,
            "description": analysis["description"],
            "search_query": search_query,
        }
