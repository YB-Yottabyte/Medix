#!/bin/sh
# Select runtime-local defaults without baking secrets or data into the image.
set -eu

profile="${1:-${MEDIX_CONTAINER_PROFILE:-}}"
if [ -z "$profile" ]; then
  if [ "${VERCEL:-}" = "1" ]; then
    profile=vercel
  else
    profile=render
  fi
fi

case "$profile" in
  render)
    runtime_root="${MEDIX_RUNTIME_ROOT:-/var/data/medix}"
    runtime_port="${PORT:-10000}"
    ;;
  vercel)
    runtime_root="${MEDIX_RUNTIME_ROOT:-/tmp/medix}"
    runtime_port="${PORT:-80}"
    ;;
  *)
    echo "Unknown Medix container profile" >&2
    exit 2
    ;;
esac

export HF_HOME="${HF_HOME:-$runtime_root/huggingface}"
export MEDIX_VIDEO_CACHE="${MEDIX_VIDEO_CACHE:-$runtime_root/videos}"
export MEDIX_TRANSCRIPT_CACHE="${MEDIX_TRANSCRIPT_CACHE:-$runtime_root/transcripts}"
export MEDIX_RESEARCH_ARTIFACTS="${MEDIX_RESEARCH_ARTIFACTS:-$runtime_root/artifacts}"
export MEDIX_FEATURE_CACHE="${MEDIX_FEATURE_CACHE:-$runtime_root/features}"
export MEDIX_SUPPORTED_VIDEO_COLLECTION="${MEDIX_SUPPORTED_VIDEO_COLLECTION:-$runtime_root/supported_video_collection.json}"
export MEDIX_PERFORMANCE_LOG="${MEDIX_PERFORMANCE_LOG:-$runtime_root/performance/backend.jsonl}"

exec uv run --frozen --no-sync uvicorn backend.app:app \
  --host 0.0.0.0 --port "$runtime_port" --proxy-headers
