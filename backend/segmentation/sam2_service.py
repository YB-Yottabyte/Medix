"""SAM 2 image segmentation service for local region highlighting."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import supervision as sv
import torch
from sam2.sam2_image_predictor import SAM2ImagePredictor

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SegmentationResult:
    """Container for segmentation output."""

    mask: np.ndarray
    bounding_box: tuple[int, int, int, int]


class SAM2SegmentationService:
    """Load and reuse a SAM 2 predictor for prompt-based image segmentation."""

    MODEL_NAME = "facebook/sam2-hiera-small"
    LABEL = "Region of Interest"

    _instance: SAM2SegmentationService | None = None

    def __new__(cls) -> SAM2SegmentationService:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.predictor = self._load_predictor()
        # Use a stronger overlay so segmented regions are visibly distinct in the UI.
        self.mask_annotator = sv.MaskAnnotator(opacity=0.7)
        self.box_annotator = sv.BoxAnnotator()
        self.label_annotator = sv.LabelAnnotator()
        self._initialized = True

    def _load_predictor(self) -> SAM2ImagePredictor:
        LOGGER.info("Loading SAM 2 model %s on %s", self.MODEL_NAME, self.device)
        predictor = SAM2ImagePredictor.from_pretrained(
            self.MODEL_NAME,
            device=self.device,
        )
        return predictor

    @staticmethod
    def _normalize_point(image: np.ndarray, point: tuple[int, int] | None) -> tuple[int, int]:
        height, width = image.shape[:2]
        if point is None:
            return width // 2, height // 2

        x = int(np.clip(point[0], 0, max(width - 1, 0)))
        y = int(np.clip(point[1], 0, max(height - 1, 0)))
        return x, y

    @staticmethod
    def _bbox_from_mask(mask: np.ndarray) -> tuple[int, int, int, int]:
        ys, xs = np.where(mask)
        if len(xs) == 0 or len(ys) == 0:
            msg = "SAM 2 did not return a valid segmentation mask."
            raise RuntimeError(msg)

        x_min = int(xs.min())
        y_min = int(ys.min())
        x_max = int(xs.max())
        y_max = int(ys.max())
        return x_min, y_min, x_max, y_max

    def segment_image(
        self,
        image: np.ndarray,
        point: tuple[int, int],
    ) -> SegmentationResult:
        """
        Segment an image using a positive point prompt.
        """
        if image.ndim != 3 or image.shape[2] != 3:
            msg = "segment_image expects an RGB image shaped as HxWx3."
            raise ValueError(msg)

        if point is None:
            msg = "segment_image requires an explicit point prompt."
            raise ValueError(msg)

        prompt_x, prompt_y = self._normalize_point(image, point)
        input_point = np.array([[prompt_x, prompt_y]], dtype=np.float32)
        input_label = np.array([1], dtype=np.int32)

        self.predictor.set_image(image)
        inference_context = torch.inference_mode()
        if self.device == "cuda":
            autocast_context = torch.autocast("cuda", dtype=torch.bfloat16)
        else:
            autocast_context = None

        with inference_context:
            if autocast_context is None:
                masks, scores, _ = self.predictor.predict(
                    point_coords=input_point,
                    point_labels=input_label,
                    multimask_output=True,
                )
            else:
                with autocast_context:
                    masks, scores, _ = self.predictor.predict(
                        point_coords=input_point,
                        point_labels=input_label,
                        multimask_output=True,
                    )

        best_index = int(np.argmax(scores))
        best_mask = masks[best_index].astype(bool)
        bounding_box = self._bbox_from_mask(best_mask)

        return SegmentationResult(mask=best_mask, bounding_box=bounding_box)

    def create_overlay(
        self,
        image: np.ndarray,
        result: SegmentationResult,
    ) -> np.ndarray:
        """Render mask, box, and label overlays using supervision annotators."""
        x_min, y_min, x_max, y_max = result.bounding_box
        xyxy = np.array([[x_min, y_min, x_max, y_max]], dtype=np.int32)
        masks = np.expand_dims(result.mask.astype(bool), axis=0)

        detections = sv.Detections(
            xyxy=xyxy,
            mask=masks,
            class_id=np.array([0], dtype=np.int32),
        )
        labels = [self.LABEL]

        annotated = image.copy()
        annotated = self.mask_annotator.annotate(scene=annotated, detections=detections)
        annotated = self.box_annotator.annotate(scene=annotated, detections=detections)
        annotated = self.label_annotator.annotate(
            scene=annotated,
            detections=detections,
            labels=labels,
        )
        return annotated
