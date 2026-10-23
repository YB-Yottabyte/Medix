"""CLIP adapter for question-to-frame similarity."""

from __future__ import annotations

import io
from importlib.metadata import version
from typing import TYPE_CHECKING

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

from backend.adapters.feature_cache import FeatureCache
from backend.performance import timed

if TYPE_CHECKING:
    from pathlib import Path

    from backend.video_processing import FrameSample


class ClipFrameScorer:
    """Score medical-procedure questions against batches of decoded frames."""

    def __init__(
        self,
        model_name: str = "openai/clip-vit-base-patch32",
        *,
        revision: str | None = None,
        device: str | None = None,
        cache_dir: Path | None = None,
    ):
        self.model_name = model_name
        self.device = device or ("mps" if torch.backends.mps.is_available() else "cpu")
        self.cache = (
            FeatureCache(
                cache_dir, f"{model_name}@{revision}:{version('transformers')}:normalized-v1"
            )
            if cache_dir
            else None
        )
        if cache_dir is not None and revision is None:
            raise ValueError("Persistent visual caching requires a pinned revision")
        self.processor = CLIPProcessor.from_pretrained(model_name, revision=revision)
        self.model = CLIPModel.from_pretrained(model_name, revision=revision).to(self.device)
        self.model.eval()

    @timed("model.clip_similarity")
    def score(
        self,
        question: str,
        frames: tuple[FrameSample, ...],
    ) -> tuple[float, ...]:
        if not question.strip():
            raise ValueError("question must not be empty")
        if not frames:
            raise ValueError("frames must not be empty")
        if self.cache is not None:
            return self._cached_score(question, frames)
        images = [Image.open(io.BytesIO(frame.jpeg_bytes)).convert("RGB") for frame in frames]
        inputs = self.processor(
            text=[question],
            images=images,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=77,
        )
        inputs = {name: value.to(self.device) for name, value in inputs.items()}
        with torch.inference_mode():
            text_features = self.model.get_text_features(
                input_ids=inputs["input_ids"],
                attention_mask=inputs["attention_mask"],
            )
            image_features = self.model.get_image_features(pixel_values=inputs["pixel_values"])
        text_features = self._feature_tensor(text_features)
        image_features = self._feature_tensor(image_features)
        text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        similarities = (image_features @ text_features.T).squeeze(1)
        normalized = torch.clamp((similarities + 1.0) / 2.0, 0.0, 1.0)
        return tuple(float(value) for value in normalized.detach().cpu().numpy())

    def _cached_score(self, question, frames):
        cache = self.cache
        keys = [cache.key(frame.jpeg_bytes) for frame in frames]
        features = {key: cache.get(key) for key in dict.fromkeys(keys)}
        missing = list(dict.fromkeys(key for key in keys if features[key] is None))
        if missing:
            by_key = dict(zip(keys, frames, strict=True))
            # Bounded batches prevent entire long videos occupying accelerator memory.
            for offset in range(0, len(missing), 32):
                batch = missing[offset : offset + 32]
                images = [
                    Image.open(io.BytesIO(by_key[key].jpeg_bytes)).convert("RGB") for key in batch
                ]
                inputs = self.processor(images=images, return_tensors="pt")
                with torch.inference_mode():
                    values = self._feature_tensor(
                        self.model.get_image_features(
                            pixel_values=inputs["pixel_values"].to(self.device)
                        )
                    )
                    values = values / values.norm(dim=-1, keepdim=True)
                for key, value in zip(batch, values.cpu().numpy(), strict=True):
                    cache.put(key, value)
                    features[key] = value
        inputs = self.processor(
            text=[question], return_tensors="pt", padding=True, truncation=True, max_length=77
        )
        with torch.inference_mode():
            query = self._feature_tensor(
                self.model.get_text_features(
                    input_ids=inputs["input_ids"].to(self.device),
                    attention_mask=inputs["attention_mask"].to(self.device),
                )
            )
            query = query / query.norm(dim=-1, keepdim=True)
            bank = torch.from_numpy(np.stack([features[key] for key in keys])).to(self.device)
            scores = torch.clamp((bank @ query.T).squeeze(1).add(1).div(2), 0, 1)
        return tuple(float(v) for v in scores.cpu().numpy())

    @staticmethod
    def _feature_tensor(output: object) -> torch.Tensor:
        """Support tensor outputs from Transformers 4.x and structured 5.x outputs."""
        if isinstance(output, torch.Tensor):
            return output
        pooled = getattr(output, "pooler_output", None)
        if isinstance(pooled, torch.Tensor):
            return pooled
        raise TypeError("CLIP feature output did not contain a tensor")
