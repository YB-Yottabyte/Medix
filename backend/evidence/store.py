"""Content-addressed local storage for evidence artifacts and manifests."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from backend.domain import EvidenceBundle


class EvidenceArtifactStore:
    """Persist generated evidence while deduplicating identical media."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.frames = self.root / "media" / "frames"
        self.clips = self.root / "media" / "clips"
        self.manifests = self.root / "bundles"

    def frame_path(self, video_id: str, timestamp_seconds: float) -> Path:
        milliseconds = round(timestamp_seconds * 1000)
        return self.frames / video_id / f"{milliseconds:012d}.jpg"

    def clip_path(self, video_id: str, start_seconds: float, end_seconds: float) -> Path:
        start_ms = round(start_seconds * 1000)
        end_ms = round(end_seconds * 1000)
        return self.clips / video_id / f"{start_ms:012d}-{end_ms:012d}.mp4"

    def manifest_path(self, bundle_id: str) -> Path:
        return self.manifests / f"{bundle_id}.json"

    def write_bytes(self, path: Path, contents: bytes) -> str:
        if not contents:
            raise ValueError("artifact contents must not be empty")
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.is_file():
            self._atomic_write(path, contents)
        return self.sha256(path)

    def write_manifest(self, bundle_id: str, payload: dict[str, Any]) -> Path:
        path = self.manifest_path(bundle_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        contents = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode()
        self._atomic_write(path, contents)
        return path

    def read_bundle(self, bundle_id: str) -> EvidenceBundle:
        """Load and validate a persisted evidence bundle."""
        path = self.manifest_path(bundle_id)
        if not path.is_file():
            raise FileNotFoundError(f"Evidence bundle manifest not found: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise TypeError(f"Evidence bundle manifest must be an object: {path}")
        return EvidenceBundle.from_dict(payload)

    def relative_path(self, path: Path) -> str:
        return str(path.resolve().relative_to(self.root.resolve()))

    @staticmethod
    def sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    @staticmethod
    def _atomic_write(path: Path, contents: bytes) -> None:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
            temporary.write(contents)
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, path)
