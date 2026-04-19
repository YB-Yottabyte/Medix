"""
Flask Web Application for Medical Procedure Q&A
Multimodal pipeline: text + image + voice + video-frame analysis
"""

import base64
import contextlib
import io
import math
import time
from pathlib import Path

import numpy as np
import yaml
from flask import Flask, jsonify, request
from PIL import Image

from backend.database.medical_db import MedicalDatabase
from backend.database.retriever import ProcedureRetriever
from backend.models.generator import ResponseGenerator
from backend.models.image_recognizer import MedicalImageRecognizer
from backend.models.llm import AIHandler, get_groq_chat_api_key
from backend.models.transcript import TranscriptFetcher
from backend.segmentation.sam2_service import SAM2SegmentationService

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
CONFIG_PATH = PROJECT_ROOT / "config.yaml"

app = Flask(
    __name__,
)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10MB max file size

# Load configuration
with CONFIG_PATH.open() as f:
    config = yaml.safe_load(f)

# Initialize components

# Load database metadata from Neon PostgreSQL and keep Qdrant as the vector store.
db = MedicalDatabase(config)
db.load()

# Initialize retriever, AI handler, and response generator
retriever = ProcedureRetriever(config, db)
ai_handler = AIHandler(config)
response_generator = ResponseGenerator(config, retriever, ai_handler)

# Initialize transcript fetcher so AI answers are grounded in video content
transcript_fetcher = TranscriptFetcher()
retriever.transcript_fetcher = transcript_fetcher

# Initialize image recognizer for visual queries
image_recognizer = MedicalImageRecognizer(config, db, retriever)
segmentation_service = SAM2SegmentationService()


def get_backend_groq_client():
    from groq import Groq

    return Groq(api_key=get_groq_chat_api_key(config))


def _is_generic_step_list(steps: list[dict] | None) -> bool:
    """Detect placeholder dataset steps like 'Watch from 369.0 to 388.0'."""
    if not steps:
        return True
    if len(steps) != 1:
        return False
    heading = (steps[0].get("heading") or steps[0].get("description") or "").strip().lower()
    return heading.startswith("watch from")


def _derive_video_steps_from_transcript(
    video_id: str | None,
    answer_start: int | None,
    answer_end: int | None,
) -> list[dict]:
    """
    Build finer-grained video steps from transcript snippets when the dataset only
    gives us one generic segment.
    """
    if not video_id or answer_start is None or answer_end is None:
        return []

    snippets = transcript_fetcher.fetch_snippets(video_id, start=answer_start, end=answer_end)
    if not snippets:
        return []

    grouped_steps = []
    current_group = []
    current_start = None
    max_group_seconds = 8
    max_group_snippets = 2

    for snippet in snippets:
        snippet_start = int(math.floor(snippet["start"]))
        snippet_end = int(math.ceil(snippet["start"] + snippet.get("duration", 0)))
        snippet_text = " ".join(str(snippet.get("text", "")).split())
        if not snippet_text:
            continue

        if current_start is None:
            current_start = snippet_start

        current_group.append({"start": snippet_start, "end": snippet_end, "text": snippet_text})
        group_span = snippet_end - current_start

        if len(current_group) >= max_group_snippets or group_span >= max_group_seconds:
            grouped_steps.append(current_group)
            current_group = []
            current_start = None

    if current_group:
        grouped_steps.append(current_group)

    derived_steps = []
    for index, group in enumerate(grouped_steps, start=1):
        start_time = group[0]["start"]
        end_time = group[-1]["end"]
        description = " ".join(item["text"] for item in group).strip()
        if len(description) > 90:
            description = description[:87].rstrip() + "..."

        derived_steps.append(
            {
                "index": index,
                "start_time": start_time,
                "end_time": end_time,
                "description": description or f"Step {index}",
            }
        )

    return derived_steps


def _build_video_steps(top_procedure: dict) -> list[dict]:
    """Prefer transcript-derived steps when stored dataset steps are only placeholders."""
    answer_start = (
        int(top_procedure["answer_start"])
        if top_procedure.get("answer_start") is not None
        else None
    )
    answer_end = (
        int(top_procedure["answer_end"]) if top_procedure.get("answer_end") is not None else None
    )

    if _is_generic_step_list(top_procedure.get("steps")):
        derived_steps = _derive_video_steps_from_transcript(
            top_procedure.get("video_id"),
            answer_start,
            answer_end,
        )
        if derived_steps:
            return derived_steps

    if top_procedure.get("steps"):
        return [
            {
                "index": idx + 1,
                "start_time": step.get("absolute_bounds", [0])[0],
                "end_time": (
                    step.get("absolute_bounds", [0, 0])[1]
                    if len(step.get("absolute_bounds", [])) > 1
                    else None
                ),
                "description": (
                    step.get("description") or step.get("heading") or f"Step {idx + 1}"
                ),
            }
            for idx, step in enumerate(top_procedure["steps"])
        ]

    return []


def _describe_region(
    image_width: int,
    image_height: int,
    bbox: tuple[int, int, int, int],
) -> str:
    """Describe the segmented region location using a simple 3x3 grid."""
    x_min, y_min, x_max, y_max = bbox
    center_x = (x_min + x_max) / 2
    center_y = (y_min + y_max) / 2

    horizontal_ratio = center_x / max(image_width, 1)
    vertical_ratio = center_y / max(image_height, 1)

    if horizontal_ratio < 1 / 3:
        horizontal = "left"
    elif horizontal_ratio > 2 / 3:
        horizontal = "right"
    else:
        horizontal = "center"

    if vertical_ratio < 1 / 3:
        vertical = "top"
    elif vertical_ratio > 2 / 3:
        vertical = "bottom"
    else:
        vertical = "center"

    if horizontal == "center" and vertical == "center":
        return "center"
    if horizontal == "center":
        return vertical
    if vertical == "center":
        return horizontal
    return f"{vertical}-{horizontal}"


def _encode_image_to_base64(image_rgb: np.ndarray) -> str:
    """Encode an RGB numpy image to a base64 PNG string."""
    buffer = io.BytesIO()
    Image.fromarray(image_rgb).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


@app.route("/api/query_video", methods=["POST"])
def query_video():
    """Handle video-enabled query requests"""
    try:
        data = request.get_json()
        user_query = data.get("query", "").strip()

        if not user_query:
            return jsonify({"error": "No query provided"}), 400

        # Generate response
        response_data = response_generator.generate(user_query)

        # Find matching video from MedVidQA data
        video_url = None
        video_id = None
        answer_start = None
        answer_end = None
        video_steps = []

        if response_data["retrieved_procedures"]:
            # Get the top procedure
            top_procedure = response_data["retrieved_procedures"][0]
            is_verified_medvidqa = top_procedure.get(
                "source"
            ) == "MedVidQA Dataset (TREC 2024)" and top_procedure.get("video_id")

            # Only return video data when a verified MedVidQA procedure was retrieved.
            if is_verified_medvidqa:
                # Extract video ID for YouTube Player API
                video_id = top_procedure["video_id"]

                # Extract YouTube embed URL
                if "youtube_embed" in top_procedure:
                    video_url = top_procedure["youtube_embed"]
                elif "youtube_url" in top_procedure:
                    video_url = top_procedure["youtube_url"]

                # Extract answer segment times (in seconds)
                if "answer_start" in top_procedure:
                    answer_start = int(top_procedure["answer_start"])
                if "answer_end" in top_procedure:
                    answer_end = int(top_procedure["answer_end"])

                # Extract steps with timestamps
                video_steps = _build_video_steps(top_procedure)

        return jsonify(
            {
                "query": response_data["query"],
                "response": response_data["response"],
                "video_url": video_url,
                "video_id": video_id,
                "answer_start": answer_start,
                "answer_end": answer_end,
                "video_steps": video_steps,
                "retrieved_procedures": response_data["retrieved_procedures"],
            }
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify(
        {
            "status": "healthy",
            "database_loaded": len(db.procedures) > 0,
            "num_procedures": len(db.procedures),
            "ai_provider": config["ai"]["provider"],
        }
    )


@app.route("/api/segment", methods=["POST"])
def segment():
    """Segment a highlighted region in an uploaded image using SAM 2."""
    try:
        if "image" not in request.files:
            return jsonify({"error": "No image file provided"}), 400

        image_file = request.files["image"]
        if image_file.filename == "":
            return jsonify({"error": "No image file selected"}), 400

        image_bytes = image_file.read()
        if len(image_bytes) == 0:
            return jsonify({"error": "Empty image file"}), 400

        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_np = np.array(pil_image)

        x_value = request.form.get("x")
        y_value = request.form.get("y")
        point = None
        if x_value is not None and y_value is not None:
            point = (int(float(x_value)), int(float(y_value)))

        result = segmentation_service.segment_image(image_np, point=point)
        overlay = segmentation_service.create_overlay(image_np, result)

        x_min, y_min, x_max, y_max = result.bounding_box
        response = {
            "highlighted_image": _encode_image_to_base64(overlay),
            "mask_data": {
                "x": x_min,
                "y": y_min,
                "width": x_max - x_min,
                "height": y_max - y_min,
            },
            "region_description": _describe_region(
                image_width=image_np.shape[1],
                image_height=image_np.shape[0],
                bbox=result.bounding_box,
            ),
        }
        return jsonify(response)

    except Exception as error:
        return jsonify({"error": f"Segmentation failed: {error!s}"}), 500


@app.route("/api/image_query", methods=["POST"])
def image_query():
    """Handle image-based medical condition recognition"""
    try:
        # Check if image file is present
        if "image" not in request.files:
            return jsonify({"error": "No image file provided"}), 400

        image_file = request.files["image"]

        if image_file.filename == "":
            return jsonify({"error": "No image file selected"}), 400

        # Read image bytes
        image_bytes = image_file.read()

        if len(image_bytes) == 0:
            return jsonify({"error": "Empty image file"}), 400

        # Check file size
        max_size = config.get("vision", {}).get("max_image_size", 10485760)
        if len(image_bytes) > max_size:
            return jsonify(
                {"error": f"Image file too large. Max size: {max_size/1024/1024}MB"}
            ), 400

        # Perform image recognition
        recognition_result = image_recognizer.recognize_from_bytes(image_bytes)

        if not recognition_result["success"]:
            return jsonify({"error": "Image recognition failed"}), 500

        top_match = recognition_result["top_match"]

        if not top_match:
            return jsonify({"error": "No matching procedures found"}), 404

        # Extract video information
        video_id = top_match.get("video_id")
        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else None

        # Get start and end times directly from the match
        answer_start = top_match.get("answer_start")
        answer_end = top_match.get("answer_end")

        # Get additional context using text query
        text_query = top_match.get("question", "")
        context_response = None

        if text_query:
            with contextlib.suppress(Exception):
                context_response = response_generator.generate(text_query)

        # Add emergency warning if detected
        emergency_warning = None
        if recognition_result.get("is_emergency"):
            emergency_warning = (
                "⚠️ EMERGENCY DETECTED: This appears to be a life-threatening situation. "
                "If this is a real emergency, CALL 911 IMMEDIATELY. "
                "The guidance below is for educational purposes only and does not replace professional medical care."
            )

        return jsonify(
            {
                "success": True,
                "recognition": {
                    "top_match": top_match,
                    "all_matches": recognition_result["all_matches"][:3],
                    "method": recognition_result["recognition_method"],
                    "detected_body_part": recognition_result.get("detected_body_part"),
                    "detected_condition": recognition_result.get("detected_condition"),
                    "detected_severity": recognition_result.get("detected_severity"),
                    "description": recognition_result.get("description"),
                    "search_query": recognition_result.get("search_query"),
                },
                "video_url": video_url,
                "video_id": video_id,
                "answer_start": answer_start,
                "answer_end": answer_end,
                "title": top_match.get("title"),
                "question": top_match.get("question"),
                "confidence": top_match.get("confidence"),
                "ai_guidance": context_response.get("response") if context_response else None,
                "is_emergency": recognition_result.get("is_emergency", False),
                "emergency_warning": emergency_warning,
            }
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": f"Internal error: {e!s}"}), 500


@app.route("/api/multimodal_query", methods=["POST"])
def multimodal_query():
    """
    Combined multimodal endpoint: accepts text + image + voice together.
    This is the primary endpoint for the AR headset pipeline:
      - Voice audio → transcribed to text via Whisper
      - Camera frame → analyzed via VLM for visual context
      - Text query (from voice or typed) + visual context → RAG search → AI response
    """
    try:
        t0 = time.time()
        text_query = ""
        visual_context = None

        # --- Extract text query ---
        if request.content_type and "multipart" in request.content_type:
            text_query = request.form.get("query", "").strip()

            # Transcribe voice if audio provided
            if "audio" in request.files:
                audio_file = request.files["audio"]
                audio_bytes = audio_file.read()
                if audio_bytes:
                    import os
                    import tempfile

                    client = get_backend_groq_client()
                    ext = (
                        audio_file.filename.rsplit(".", 1)[-1]
                        if "." in audio_file.filename
                        else "webm"
                    )
                    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
                        tmp.write(audio_bytes)
                        tmp_path = tmp.name
                    try:
                        with open(tmp_path, "rb") as f:
                            transcription = client.audio.transcriptions.create(
                                model="whisper-large-v3", file=f, language="en"
                            )
                        voice_text = transcription.text.strip()
                        # Combine with any typed text
                        text_query = (
                            f"{text_query} {voice_text}".strip() if text_query else voice_text
                        )
                    finally:
                        os.unlink(tmp_path)

            # Analyze image/frame if provided
            if "image" in request.files:
                img_bytes = request.files["image"].read()
                if img_bytes:
                    image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                    image_answer = image_recognizer.analyze_image(
                        image, question=text_query or None
                    )
                    visual_context = image_recognizer.recognize_from_image(
                        image,
                        question=text_query or None,
                        analysis_text=image_answer,
                    )
                    visual_context["analysis_text"] = image_answer
        else:
            # JSON request
            data = request.get_json() or {}
            text_query = data.get("query", "").strip()

            if data.get("frame_base64"):
                b64 = data["frame_base64"]
                if "," in b64:
                    b64 = b64.split(",", 1)[1]
                img_bytes = base64.b64decode(b64)
                image = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                image_answer = image_recognizer.analyze_image(image, question=text_query or None)
                visual_context = image_recognizer.recognize_from_image(
                    image,
                    question=text_query or None,
                    analysis_text=image_answer,
                )
                visual_context["analysis_text"] = image_answer

        if not text_query and not visual_context:
            return jsonify({"error": "No query, audio, or image provided"}), 400

        # --- Build enriched query from text + visual context ---
        enriched_query = text_query
        if visual_context and visual_context.get("success"):
            vc = visual_context
            visual_desc = vc.get("analysis_text") or vc.get("description", "")
            if text_query:
                enriched_query = f"{text_query}. Image analysis: {visual_desc}"
            else:
                enriched_query = vc.get("search_query", visual_desc)

        # --- RAG: multi-query search ---
        queries = [enriched_query]
        weights = [0.6]
        if text_query and text_query != enriched_query:
            queries.append(text_query)
            weights.append(0.2)
        if visual_context and visual_context.get("search_query"):
            queries.append(visual_context["search_query"])
            weights.append(0.2)

        if visual_context and visual_context.get("success"):
            body_part = visual_context.get("detected_body_part")
            condition = visual_context.get("detected_condition")
            text_retrieved = retriever.search_with_context(
                enriched_query,
                body_part=body_part,
                condition=condition,
            )
        else:
            text_retrieved = retriever.multi_query_search(queries, weights) if text_query else []
        retrieved = text_retrieved

        # --- Generate AI response (explicitly grounded in both text and vision) ---
        context = retriever.format_results_for_context(retrieved)
        if visual_context and visual_context.get("success"):
            visual_context_block = (
                "\n\nVISUAL FINDINGS (from uploaded image):\n"
                f"- Body part: {visual_context.get('detected_body_part', 'unknown')}\n"
                f"- Condition: {visual_context.get('detected_condition', 'unknown')}\n"
                f"- Severity: {visual_context.get('detected_severity', 'unknown')}\n"
                f"- Description: {visual_context.get('analysis_text', visual_context.get('description', ''))}\n"
                "Use these visual findings together with the user's question and transcript context."
            )
            context = f"{context}{visual_context_block}"

        combined_query = (
            text_query
            if text_query
            else "Please give first-aid guidance based on the image findings and retrieved context."
        )

        ai_response = ai_handler.generate_multimodal_response(combined_query, context)

        # Extract video info from top result
        video_id = None
        answer_start = None
        answer_end = None
        if retrieved:
            top = retrieved[0]
            video_id = top.get("video_id")
            answer_start = top.get("answer_start")
            answer_end = top.get("answer_end")

        latency_ms = int((time.time() - t0) * 1000)

        # Emergency detection
        is_emergency = False
        emergency_warning = None
        if visual_context and visual_context.get("is_emergency"):
            is_emergency = True
        if is_emergency:
            emergency_warning = (
                "⚠️ EMERGENCY DETECTED: This appears to be a life-threatening situation. "
                "If this is a real emergency, CALL 911 IMMEDIATELY."
            )

        return jsonify(
            {
                "success": True,
                "query": text_query,
                "enriched_query": enriched_query,
                "response": ai_response,
                "video_id": video_id,
                "video_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
                "answer_start": answer_start,
                "answer_end": answer_end,
                "retrieved_procedures": retrieved,
                "visual_analysis": {
                    "body_part": visual_context.get("detected_body_part")
                    if visual_context
                    else None,
                    "condition": visual_context.get("detected_condition")
                    if visual_context
                    else None,
                    "severity": visual_context.get("detected_severity") if visual_context else None,
                    "description": visual_context.get("description") if visual_context else None,
                }
                if visual_context
                else None,
                "is_emergency": is_emergency,
                "emergency_warning": emergency_warning,
                "latency_ms": latency_ms,
                "pipeline": "multimodal-rag",
            }
        )

    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def main():
    host = config["web"]["host"]
    port = config["web"]["port"]
    debug = config["web"]["debug"]

    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
