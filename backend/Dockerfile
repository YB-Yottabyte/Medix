FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgomp1 espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=10000 \
    HF_HOME=/var/data/medix/huggingface \
    MEDIX_CONFIG=/app/backend/config.render.yaml \
    MEDIX_VIDEO_CACHE=/var/data/medix/videos \
    MEDIX_TRANSCRIPT_CACHE=/var/data/medix/transcripts \
    MEDIX_RESEARCH_ARTIFACTS=/var/data/medix/artifacts \
    MEDIX_FEATURE_CACHE=/var/data/medix/features \
    MEDIX_SUPPORTED_VIDEO_COLLECTION=/var/data/medix/supported_video_collection.json \
    MEDIX_PERFORMANCE_LOG=/var/data/medix/performance/backend.jsonl

COPY pyproject.toml uv.lock README.md LICENSE ./
ARG MEDIX_WITH_SPEECH=1
RUN if [ "$MEDIX_WITH_SPEECH" = "1" ]; then \
      uv sync --frozen --no-dev --no-install-project --extra speech; \
    else uv sync --frozen --no-dev --no-install-project; fi
COPY backend ./backend
COPY data/medvidqa_video_catalog.json ./data/medvidqa_video_catalog.json

# Keep secrets and evidence media outside the image. The default deployment
# profile includes speech; build with MEDIX_WITH_SPEECH=0 for a lean image.
EXPOSE 10000
CMD ["sh", "-c", "exec uv run --frozen --no-sync uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers"]
