FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgomp1 espeak-ng libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    MEDIX_CONFIG=/app/backend/config.render.yaml

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
CMD ["sh", "backend/start-container.sh"]
