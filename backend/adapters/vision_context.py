"""Provider-neutral image input boundary; image observations are not evidence."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Protocol

from PIL import Image


@dataclass(frozen=True)
class VisualObservation:
    visible_objects: tuple[str, ...] = ()
    visible_actions: tuple[str, ...] = ()
    uncertainty: str = ""
    model_id: str = ""


class VisionContextModel(Protocol):
    def observe(self, *, question: str, image_bytes: bytes) -> VisualObservation: ...


@dataclass(frozen=True)
class PreparedMultimodalQuery:
    question: str
    observation: VisualObservation | None
    image_supplied: bool
    vision_status: str


class OptionalVisionAdapter:
    """Validate uploads and obtain observations without rewriting the query.

    A later provider implements VisionContextModel. No credentials, network,
    diagnosis, retrieval, or answer generation are built into this boundary.
    """

    def __init__(self, model: VisionContextModel | None = None):
        self.model = model

    def prepare(self, question: str, image_bytes: bytes | None = None) -> PreparedMultimodalQuery:
        question = question.strip()
        if not question:
            raise ValueError("A text question is required")
        if image_bytes is None:
            return PreparedMultimodalQuery(question, None, False, "not_requested")
        if not image_bytes or len(image_bytes) > 10 * 1024 * 1024:
            raise ValueError("Image must be nonempty and at most 10 MiB")
        with Image.open(io.BytesIO(image_bytes)) as image:
            if image.width * image.height > 20_000_000:
                raise ValueError("Image exceeds 20 megapixels")
            image.verify()
        if self.model is None:
            return PreparedMultimodalQuery(question, None, True, "provider_not_configured")
        observation = self.model.observe(question=question, image_bytes=image_bytes)
        if not isinstance(observation, VisualObservation):
            raise TypeError("Vision provider must return VisualObservation")
        return PreparedMultimodalQuery(question, observation, True, "observed")
