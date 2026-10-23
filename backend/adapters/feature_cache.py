"""Opt-in, content-addressed feature caches; no labels or credentials in keys."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import numpy as np

from backend.performance import count, timed


class FeatureCache:
    def __init__(self, directory: Path, namespace: str):
        self.directory = Path(directory) / hashlib.sha256(namespace.encode()).hexdigest()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.hits = 0
        self.misses = 0

    def key(self, content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    def get(self, key: str) -> np.ndarray | None:
        try:
            value = np.load(self.directory / f"{key}.npy", allow_pickle=False)
        except (OSError, ValueError, EOFError):
            self.misses += 1
            count("feature_cache.miss")
            return None
        if value.ndim != 1 or value.dtype.kind not in "fiu" or not np.isfinite(value).all():
            self.misses += 1
            count("feature_cache.miss")
            return None
        self.hits += 1
        count("feature_cache.hit")
        return value

    def put(self, key: str, value: np.ndarray) -> None:
        value = np.asarray(value)
        if value.ndim != 1 or value.dtype.kind not in "fiu" or not np.isfinite(value).all():
            raise ValueError("Expected a finite feature vector")
        descriptor, name = tempfile.mkstemp(dir=self.directory, suffix=".tmp")
        try:
            with os.fdopen(descriptor, "wb") as output:
                np.save(output, value, allow_pickle=False)
            os.replace(name, self.directory / f"{key}.npy")
        finally:
            Path(name).unlink(missing_ok=True)


class CachedTextEncoder:
    """Cache the pipeline's NumPy sentence encodings across runs and queries.

    Caller supplies a namespace including pinned model and software versions.
    Encoding options and text are included in each key. Tensor/string APIs are
    deliberately unsupported, rather than silently changing their semantics.
    """

    def __init__(self, encoder, directory: Path, namespace: str):
        self.encoder = encoder
        self.cache = FeatureCache(directory, namespace)

    @timed("model.text_embedding")
    def encode(self, sentences: list[str], **kwargs) -> np.ndarray:
        if isinstance(sentences, str) or kwargs.get("convert_to_tensor"):
            raise ValueError("CachedTextEncoder requires a list and NumPy output")
        options = {k: v for k, v in kwargs.items() if k not in {"batch_size", "show_progress_bar"}}
        keys = [
            self.cache.key(json.dumps([text, options], sort_keys=True).encode())
            for text in sentences
        ]
        values = {key: self.cache.get(key) for key in dict.fromkeys(keys)}
        missing = list(dict.fromkeys(key for key in keys if values[key] is None))
        if missing:
            texts = dict(zip(keys, sentences, strict=True))
            encoded = np.asarray(self.encoder.encode([texts[key] for key in missing], **kwargs))
            if encoded.ndim != 2 or len(encoded) != len(missing):
                raise ValueError("Encoder returned unexpected shape")
            for key, value in zip(missing, encoded, strict=True):
                self.cache.put(key, value)
                values[key] = value
        if not keys:
            raise ValueError("At least one sentence is required")
        return np.stack([values[key] for key in keys])
