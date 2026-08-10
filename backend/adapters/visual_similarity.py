"""CLIP adapter for question-to-frame similarity."""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

if TYPE_CHECKING:
    from backend.video_processing import FrameSample


class ClipFrameScorer:
    """Score medical-procedure questions against batches of decoded frames."""

    def __init__(
        self,
        model_name: str = "openai/clip-vit-base-patch32",
        *,
        revision: str | None = None,
        device: str | None = None,
    ):
        self.model_name = model_name
        self.device = device or ("mps" if torch.backends.mps.is_available() else "cpu")
        self.processor = CLIPProcessor.from_pretrained(model_name, revision=revision)
        self.model = CLIPModel.from_pretrained(model_name, revision=revision).to(self.device)
        self.model.eval()

    def score(
        self,
        question: str,
        frames: tuple[FrameSample, ...],
    ) -> tuple[float, ...]:
        if not question.strip():
            raise ValueError("question must not be empty")
        if not frames:
            raise ValueError("frames must not be empty")
        images = [Image.open(io.BytesIO(frame.jpeg_bytes)).convert("RGB") for frame in frames]
        inputs = self.processor(
            text=[question],
            images=images,
            return_tensors="pt",
            padding=True,
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

    @staticmethod
    def _feature_tensor(output: object) -> torch.Tensor:
        """Support tensor outputs from Transformers 4.x and structured 5.x outputs."""
        if isinstance(output, torch.Tensor):
            return output
        pooled = getattr(output, "pooler_output", None)
        if isinstance(pooled, torch.Tensor):
            return pooled
        raise TypeError("CLIP feature output did not contain a tensor")
