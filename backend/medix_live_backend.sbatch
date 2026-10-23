#!/bin/bash
#SBATCH --job-name=medix-live
#SBATCH --partition=public
#SBATCH --qos=class
#SBATCH --time=02:00:00
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --output=medix-live-%j.out
#SBATCH --error=medix-live-%j.err

# Manual submission only. Voyager provides inference; this is a CPU evidence/API job.
set -euo pipefail
module purge
module load mamba/latest
source activate medix
cd "$HOME/Medix"
WORK_ROOT="/scratch/$USER/medix-work"
RUN_ROOT="$WORK_ROOT/live-$SLURM_JOB_ID"
mkdir -p "$RUN_ROOT"
export HF_HOME="$WORK_ROOT/huggingface"
export UV_CACHE_DIR="$WORK_ROOT/uv-cache"
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 UV_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1
export OMP_NUM_THREADS=4 MKL_NUM_THREADS=4
export MEDIX_VIDEO_CACHE="${MEDIX_VIDEO_CACHE:-$WORK_ROOT/validation-check-65027646/videos}"
# Prefer the grouped layout; retain access to caches already present on Sol.
DEFAULT_TRANSCRIPT_CACHE="$HOME/Medix/development/evaluation/results/week1/2026-10-04-final-resource-snapshot-v1/transcript_cache"
LEGACY_TRANSCRIPT_CACHE="$HOME/Medix/evaluation/results/week1/2026-10-04-final-resource-snapshot-v1/transcript_cache"
if [[ ! -d "$DEFAULT_TRANSCRIPT_CACHE" && -d "$LEGACY_TRANSCRIPT_CACHE" ]]; then
  DEFAULT_TRANSCRIPT_CACHE="$LEGACY_TRANSCRIPT_CACHE"
fi
export MEDIX_TRANSCRIPT_CACHE="${MEDIX_TRANSCRIPT_CACHE:-$DEFAULT_TRANSCRIPT_CACHE}"
export MEDIX_VIDEO_CATALOG="$HOME/Medix/data/medvidqa_video_catalog.json"
export MEDIX_RESEARCH_ARTIFACTS="$RUN_ROOT/artifacts"
export MEDIX_SUPPORTED_VIDEO_COLLECTION="$RUN_ROOT/supported_video_collection.json"
export MEDIX_FEATURE_CACHE="$WORK_ROOT/live-features"
export MEDIX_MAX_EVIDENCE_CANDIDATES=2
export PYTHONUNBUFFERED=1
export MEDIX_CONFIG="$RUN_ROOT/config.yaml"
export MEDIX_VISION_PROVIDER=voyager ASU_RC_MODEL=qwen35-27b
# Existing Sol keys may still be in the former root location.
DEFAULT_VOYAGER_ENV_FILE="$HOME/Medix/backend/.env.sol.local"
if [[ ! -f "$DEFAULT_VOYAGER_ENV_FILE" && -f "$HOME/Medix/.env.sol.local" ]]; then
  DEFAULT_VOYAGER_ENV_FILE="$HOME/Medix/.env.sol.local"
fi
: "${MEDIX_VOYAGER_ENV_FILE:=$DEFAULT_VOYAGER_ENV_FILE}"
test -f "$MEDIX_VOYAGER_ENV_FILE"
test -d "$MEDIX_VIDEO_CACHE"
test -d "$MEDIX_TRANSCRIPT_CACHE"
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
# Use the private key file, even if the submitting shell exported an empty key.
unset ASU_RC_API_KEY
uv run --env-file "$MEDIX_VOYAGER_ENV_FILE" --no-sync python - <<'PYCONFIG'
import os
from pathlib import Path
import yaml
if not os.environ.get("ASU_RC_API_KEY", "").strip():
    raise ValueError("ASU_RC_API_KEY missing from .env.sol.local")
config = yaml.safe_load(Path("backend/config.example.yaml").read_text())
config["research_pipeline"].update(enabled=True, answer_model="structured_voyager", supported_collection_only=True)
config["web"].update(host="0.0.0.0", port=5001, debug=False)
Path(os.environ["MEDIX_CONFIG"]).write_text(yaml.safe_dump(config))
PYCONFIG
uv run --no-sync python -m development.scripts.build_runtime_collection \
  --catalog "$MEDIX_VIDEO_CATALOG" --transcript-cache "$MEDIX_TRANSCRIPT_CACHE" \
  --video-cache "$MEDIX_VIDEO_CACHE" --output "$MEDIX_SUPPORTED_VIDEO_COLLECTION"
printf 'Compute node: %s\nTunnel on Mac: ssh -N -L 5002:%s:5001 skukunu1@sol.asu.edu\n' "$(hostname -s)" "$(hostname -s)"
# No reload process: initialize the models once on the allocated compute node.
exec uv run --env-file "$MEDIX_VOYAGER_ENV_FILE" --no-sync uvicorn backend.app:app --host 0.0.0.0 --port 5001
