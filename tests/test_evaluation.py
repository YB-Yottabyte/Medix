"""Tests for thesis evaluation manifests and metrics."""

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch

from backend.adapters.visual_similarity import ClipFrameScorer
from backend.domain import (
    LocalizationRequest,
    TemporalSegment,
    TranscriptCue,
    VideoCandidate,
    VideoDocument,
)
from backend.evidence import (
    EvidenceArtifactStore,
    EvidenceExtractionRequest,
    EvidenceExtractor,
)
from backend.services.end_to_end import EndToEndMedicalPipeline
from backend.temporal_localization import (
    MultimodalWindowLocalizer,
    TranscriptWindowLocalizer,
)
from backend.transcripts import CachedTranscriptRepository, TranscriptUnavailableError
from backend.video_processing import (
    ClipArtifact,
    FrameSample,
    LocalVideoRepository,
    VideoUnavailableError,
)
from backend.video_retrieval import SemanticVideoRetriever, VideoCatalog
from evaluation.build_conflict_manifest import (
    ConflictManifestValidator,
    build_conflict_manifest,
)
from evaluation.build_manifest import build_manifest
from evaluation.medvidqa_dataset import (
    OFFICIAL_SPLIT_SIZES,
    OFFICIAL_VIDEO_COUNTS,
    OfficialMedVidQADataset,
    load_official_split,
)
from evaluation.metrics import (
    interval_iou,
    summarize_localization_predictions,
    summarize_predictions,
    summarize_video_retrieval,
)
from evaluation.run_offline_retrieval import lexical_overlap, rank_candidates
from evaluation.run_retrieval import _run_sample
from evaluation.run_temporal_baselines import evaluate_localizer
from evaluation.run_transcript_localization import localization_report
from evaluation.select_end_to_end_configuration import (
    select_validation_configuration,
)
from evaluation.temporal_baselines import (
    AnnotatedOracleLocalizer,
    RandomModeLocalizer,
    validation_mode_duration,
)
from evaluation.video_catalog import VideoCatalogBuilder, load_video_documents
from scripts.build_database import ProcedureCacheBuilder


class StubEvaluationRetriever:
    def search(self, _query: str) -> list[dict[str, object]]:
        return [
            {
                "sample_id": "query",
                "video_id": "expected",
                "question": "Exact indexed question",
                "similarity_score": 1.0,
            },
            {
                "sample_id": "other",
                "video_id": "expected",
                "question": "Related question from the video",
                "similarity_score": 0.7,
            },
        ]


class StubVideoMetadataFetcher:
    def fetch(self, video_id: str) -> dict[str, str]:
        return {
            "title": f"Public title for {video_id}",
            "author_name": "Medical educator",
        }


class StubTextEncoder:
    def encode(self, sentences: list[str], **_kwargs: object) -> np.ndarray:
        vectors = []
        for sentence in sentences:
            normalized = sentence.lower()
            vectors.append(
                [
                    float("wound" in normalized),
                    float("sling" in normalized),
                ]
            )
        return np.asarray(vectors, dtype=np.float32)


def test_interval_iou_uses_temporal_union() -> None:
    assert interval_iou(10, 30, 20, 40) == 1 / 3
    assert interval_iou(10, 30, None, None) == 0


def test_summary_reports_retrieval_and_localization_metrics() -> None:
    summary = summarize_predictions(
        [
            {
                "expected_video_id": "target",
                "expected_start": 10,
                "expected_end": 30,
                "retrieved": [
                    {
                        "video_id": "other",
                        "answer_start": 0,
                        "answer_end": 5,
                    },
                    {
                        "video_id": "target",
                        "answer_start": 10,
                        "answer_end": 30,
                    },
                ],
            }
        ]
    )

    assert summary["recall_at_1"] == 0
    assert summary["recall_at_5"] == 1
    assert summary["mean_reciprocal_rank"] == 0.5
    assert summary["mean_temporal_iou"] == 0


def test_video_retrieval_summary_does_not_report_temporal_iou() -> None:
    summary = summarize_video_retrieval(
        [
            {
                "expected_video_id": "target",
                "retrieved": [
                    {"video_id": "other"},
                    {"video_id": "target"},
                ],
            }
        ]
    )

    assert summary == {
        "samples": 1,
        "recall_at_1": 0,
        "recall_at_5": 1,
        "mean_reciprocal_rank": 0.5,
    }


def test_localization_metrics_match_paper_threshold_definitions() -> None:
    summary = summarize_localization_predictions(
        [
            {
                "expected_video_id": "video",
                "expected_start": 10,
                "expected_end": 30,
                "predicted_video_id": "video",
                "predicted_start": 10,
                "predicted_end": 30,
            },
            {
                "expected_video_id": "video",
                "expected_start": 10,
                "expected_end": 30,
                "predicted_video_id": "wrong-video",
                "predicted_start": 10,
                "predicted_end": 30,
            },
        ]
    )

    assert summary == {
        "samples": 2,
        "r_at_1_iou_0.3": 0.5,
        "r_at_1_iou_0.5": 0.5,
        "r_at_1_iou_0.7": 0.5,
        "mean_iou": 0.5,
    }


def test_manifest_keeps_official_ground_truth_fields() -> None:
    manifest = build_manifest(
        [
            {
                "sample_id": 1,
                "question": "How is this done?",
                "video_id": "video-1",
                "answer_start": 12,
                "answer_end": 24,
                "unused": "not copied",
            }
        ]
    )

    assert manifest == [
        {
            "sample_id": "1",
            "question": "How is this done?",
            "expected_video_id": "video-1",
            "expected_start": 12.0,
            "expected_end": 24.0,
        }
    ]


def test_manifest_prefers_numeric_zero_timestamp() -> None:
    [manifest] = build_manifest(
        [
            {
                "sample_id": 1,
                "question": "How is this procedure performed?",
                "video_id": "video-1",
                "answer_start": "00:00",
                "answer_end": "00:04",
                "answer_start_second": 0,
                "answer_end_second": 4,
            }
        ]
    )

    assert manifest["expected_start"] == 0
    assert manifest["expected_end"] == 4


def test_official_dataset_preserves_paper_splits() -> None:
    project_root = Path(__file__).resolve().parents[1]
    dataset = OfficialMedVidQADataset.load(project_root / "MedVidQA")

    splits = {
        "train": dataset.train,
        "val": dataset.validation,
        "test": dataset.test,
    }
    assert {name: len(samples) for name, samples in splits.items()} == (OFFICIAL_SPLIT_SIZES)
    assert {
        name: len({sample.video_id for sample in samples}) for name, samples in splits.items()
    } == OFFICIAL_VIDEO_COUNTS
    assert any(
        sample.answer_start_seconds == 0 and sample.answer_duration_seconds < 10
        for samples in splits.values()
        for sample in samples
    )


def test_official_split_loader_preserves_short_zero_start_segment(tmp_path: Path) -> None:
    split = tmp_path / "split.json"
    split.write_text(
        json.dumps(
            [
                {
                    "sample_id": "zero",
                    "question": "How is this short procedure performed?",
                    "video_id": "video-zero",
                    "answer_start": "00:00",
                    "answer_end": "00:04",
                    "answer_start_second": 0,
                    "answer_end_second": 4,
                    "video_length": 20,
                }
            ]
        ),
        encoding="utf-8",
    )

    [sample] = load_official_split(split)

    assert sample.answer_start_seconds == 0
    assert sample.answer_end_seconds == 4


def test_temporal_baseline_and_oracle_implement_localizer_contract() -> None:
    project_root = Path(__file__).resolve().parents[1]
    dataset = OfficialMedVidQADataset.load(project_root / "MedVidQA")
    sample = dataset.test[0]

    mode_duration = validation_mode_duration(dataset.validation)
    assert mode_duration == 36

    [random_prediction] = evaluate_localizer(
        (sample,),
        RandomModeLocalizer(mode_duration, seed=7),
    )
    assert random_prediction["model_name"] == "random-mode"
    assert 0 <= random_prediction["predicted_start"] < random_prediction["predicted_end"]
    assert random_prediction["predicted_end"] <= sample.video_duration_seconds

    [oracle_prediction] = evaluate_localizer(
        (sample,),
        AnnotatedOracleLocalizer((sample,)),
    )
    assert oracle_prediction["model_name"] == "annotated-oracle-evaluation-only"
    assert oracle_prediction["predicted_start"] == sample.answer_start_seconds
    assert oracle_prediction["predicted_end"] == sample.answer_end_seconds


def test_retrieval_evaluation_excludes_exact_indexed_question() -> None:
    result = _run_sample(
        {
            "sample_id": "query",
            "question": "Exact indexed question",
            "expected_video_id": "expected",
            "expected_start": 1,
            "expected_end": 2,
        },
        StubEvaluationRetriever(),
    )

    assert result["evaluation_protocol"] == "leave-one-question-out"
    assert [item["question"] for item in result["retrieved"]] == ["Related question from the video"]


def test_offline_retrieval_excludes_self_and_blends_lexical_score() -> None:
    corpus = [
        {"sample_id": "self", "video_id": "v1", "question": "dress wound"},
        {"sample_id": "other", "video_id": "v1", "question": "dress a wound safely"},
        {"sample_id": "third", "video_id": "v2", "question": "apply a sling"},
    ]
    embeddings = np.asarray([[1.0, 0.0], [0.9, 0.1], [0.0, 1.0]], dtype=np.float32)

    ranked = rank_candidates(
        "dress wound",
        np.asarray([1.0, 0.0], dtype=np.float32),
        corpus,
        embeddings,
        excluded_sample_id="self",
        top_k=2,
        lexical_weight=0.15,
    )

    assert ranked[0]["sample_id"] == "other"
    assert all(item["sample_id"] != "self" for item in ranked)
    assert lexical_overlap("dress wound", "dress a wound safely") == 1.0
    assert ranked[0]["lexical_score"] == 1.0


def test_conflict_manifest_has_review_required_balanced_conditions() -> None:
    records = [
        {
            "sample_id": "one",
            "video_id": "video-one",
            "question": "How to dress a wound?",
            "answer_start_second": 10,
            "answer_end_second": 20,
        },
        {
            "sample_id": "two",
            "video_id": "video-two",
            "question": "How to apply a sling?",
            "answer_start_second": 30,
            "answer_end_second": 50,
        },
    ]

    cases = build_conflict_manifest(records, source_cases=2)
    ConflictManifestValidator().validate(cases)

    assert len(cases) == 6
    assert {case["conflict_type"] for case in cases} == {
        "aligned",
        "visual_conflict",
        "ambiguous_visual_resolves",
    }
    assert all(case["review_status"] == "pending" for case in cases)
    conflict = next(case for case in cases if case["conflict_type"] == "visual_conflict")
    assert conflict["expected_video_id"] != conflict["visual_source_video_id"]


def test_seed_conflict_manifest_remains_pending_review() -> None:
    path = (
        Path(__file__).resolve().parents[1] / "evaluation" / "datasets" / "evidence_conflicts.json"
    )
    cases = json.loads(path.read_text(encoding="utf-8"))

    ConflictManifestValidator().validate(cases)
    assert len(cases) == 24
    assert all(case["review_status"] == "pending" for case in cases)


def test_cache_builder_deduplicates_normalized_questions() -> None:
    records = [
        {
            "sample_id": 1,
            "video_id": "video",
            "question": "How to dress a wound? ",
            "video_url": "https://example.test/video",
            "answer_start_second": 10,
            "answer_end_second": 20,
        },
        {
            "sample_id": 2,
            "video_id": "video",
            "question": " how TO dress a WOUND?",
            "video_url": "https://example.test/video",
            "answer_start_second": 30,
            "answer_end_second": 40,
        },
    ]

    procedures = ProcedureCacheBuilder._procedures(records)

    assert len(procedures) == 1
    assert procedures[0]["sample_id"] == "1"
    assert procedures[0]["answer_start"] == 10


def test_video_catalog_has_one_document_per_video_without_answer_labels() -> None:
    records = [
        {
            "sample_id": "one",
            "video_id": "video-one",
            "question": "How to dress a wound?",
            "answer_start_second": 10,
            "answer_end_second": 20,
            "video_length": 60,
        },
        {
            "sample_id": "two",
            "video_id": "video-one",
            "question": "How should gauze be applied?",
            "answer_start_second": 30,
            "answer_end_second": 40,
            "video_length": 60,
        },
    ]

    result = VideoCatalogBuilder(StubVideoMetadataFetcher()).build(records)
    serialized = result.as_serializable()

    assert len(result.documents) == 1
    assert result.documents[0].video_id == "video-one"
    assert "question" not in serialized["documents"][0]
    assert "answer_start_second" not in serialized["documents"][0]
    assert load_video_documents(serialized) == result.documents


def test_video_catalog_loader_rejects_benchmark_labels() -> None:
    payload = {
        "documents": [
            {
                "video_id": "video",
                "title": "Wound care",
                "duration_seconds": 60,
                "source_uri": "https://example.test/video",
                "question": "Leaked expert question",
            }
        ]
    }

    try:
        load_video_documents(payload)
    except ValueError as exc:
        assert "prohibited benchmark labels" in str(exc)
    else:
        raise AssertionError("label-bearing video document should be rejected")


def test_semantic_video_retriever_ranks_unique_video_documents() -> None:
    documents = (
        VideoDocument(
            video_id="wound-video",
            title="Wound dressing",
            duration_seconds=60,
            source_uri="https://example.test/wound",
        ),
        VideoDocument(
            video_id="sling-video",
            title="Apply an arm sling",
            duration_seconds=90,
            source_uri="https://example.test/sling",
        ),
    )
    retriever = SemanticVideoRetriever.build(
        documents,
        StubTextEncoder(),
        lexical_weight=0,
        batch_size=2,
    )

    candidates = retriever.retrieve("How do I dress a wound?", limit=2)

    assert [candidate.video_id for candidate in candidates] == [
        "wound-video",
        "sling-video",
    ]
    assert all(candidate.retrieval_score <= 1 for candidate in candidates)


def test_cached_transcript_repository_loads_and_sorts_cues(tmp_path: Path) -> None:
    (tmp_path / "video.json").write_text(
        json.dumps(
            [
                {"start": 10, "duration": 3, "text": "second cue"},
                {"start": 1, "duration": 2, "text": "first cue"},
            ]
        ),
        encoding="utf-8",
    )
    repository = CachedTranscriptRepository(tmp_path)

    cues = repository.load("video")

    assert [cue.text for cue in cues] == ["first cue", "second cue"]
    assert cues[0].end_seconds == 3


def test_cached_transcript_repository_reports_missing_video(tmp_path: Path) -> None:
    repository = CachedTranscriptRepository(tmp_path)

    try:
        repository.load("missing")
    except TranscriptUnavailableError:
        pass
    else:
        raise AssertionError("missing transcript should not be silently ignored")


class StubTranscriptRepository:
    def load(self, _video_id: str) -> tuple[TranscriptCue, ...]:
        return (
            TranscriptCue(start_seconds=0, duration_seconds=5, text="dress wound"),
            TranscriptCue(start_seconds=10, duration_seconds=5, text="apply arm sling"),
        )


class StubClipExtractor:
    def extract(
        self,
        _video_id: str,
        start_seconds: float,
        end_seconds: float,
        output_path: Path,
    ) -> ClipArtifact:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"synthetic clip")
        return ClipArtifact(
            path=output_path,
            duration_seconds=end_seconds - start_seconds,
        )


class StubEndToEndRetriever:
    model_name = "stub-retriever"

    def retrieve(
        self,
        _question: str,
        *,
        limit: int = 5,
    ) -> tuple[VideoCandidate, ...]:
        return (
            VideoCandidate(
                video_id="other",
                title="Other procedure",
                retrieval_score=0.9,
                source_uri="https://example.test/other",
            ),
            VideoCandidate(
                video_id="video",
                title="Wound and sling procedure",
                retrieval_score=0.8,
                source_uri="https://example.test/video",
            ),
        )[:limit]


class StubEndToEndLocalizer:
    model_name = "stub-localizer"

    def localize(self, request: LocalizationRequest) -> TemporalSegment:
        score = 0.9 if request.video_id == "video" else 0.1
        return TemporalSegment(
            video_id=request.video_id,
            start_seconds=10,
            end_seconds=20,
            localization_score=score,
            model_name=self.model_name,
        )


def test_transcript_window_localizer_selects_question_relevant_window() -> None:
    localizer = TranscriptWindowLocalizer(
        repository=StubTranscriptRepository(),
        encoder=StubTextEncoder(),
        window_seconds=10,
        stride_seconds=10,
        embedding_model_name="stub",
    )

    segment = localizer.localize(
        LocalizationRequest(
            question="How do I apply a sling?",
            video_id="video",
            duration_seconds=20,
        )
    )

    assert segment.start_seconds == 10
    assert segment.end_seconds == 20
    assert segment.model_name == "transcript-window-10s-stride-10s:stub"


class StubFrameExtractor:
    def extract(
        self,
        video_id: str,
        timestamps_seconds: tuple[float, ...],
    ) -> tuple[FrameSample, ...]:
        return tuple(
            FrameSample(
                video_id=video_id,
                timestamp_seconds=timestamp,
                jpeg_bytes=f"{timestamp}".encode(),
            )
            for timestamp in timestamps_seconds
        )


class StubFrameScorer:
    model_name = "stub-visual"

    def score(
        self,
        _question: str,
        frames: tuple[FrameSample, ...],
    ) -> tuple[float, ...]:
        return tuple(0.9 if frame.timestamp_seconds >= 10 else 0.1 for frame in frames)


class MissingFrameExtractor:
    def extract(
        self,
        video_id: str,
        _timestamps_seconds: tuple[float, ...],
    ) -> tuple[FrameSample, ...]:
        raise VideoUnavailableError(f"missing {video_id}")


def test_multimodal_localizer_can_visually_rerank_transcript_windows() -> None:
    transcript = TranscriptWindowLocalizer(
        repository=StubTranscriptRepository(),
        encoder=StubTextEncoder(),
        window_seconds=10,
        stride_seconds=10,
        embedding_model_name="stub",
    )
    localizer = MultimodalWindowLocalizer(
        transcript_localizer=transcript,
        frame_extractor=StubFrameExtractor(),
        frame_scorer=StubFrameScorer(),
        transcript_weight=0,
        frames_per_window=1,
    )

    result = localizer.localize_with_details(
        LocalizationRequest(
            question="How do I dress a wound?",
            video_id="video",
            duration_seconds=20,
        )
    )

    assert result.used_visual_evidence is True
    assert result.segment.start_seconds == 10
    assert result.visual_score == 0.9


def test_multimodal_localizer_falls_back_when_video_is_unavailable() -> None:
    transcript = TranscriptWindowLocalizer(
        repository=StubTranscriptRepository(),
        encoder=StubTextEncoder(),
        window_seconds=10,
        stride_seconds=10,
        embedding_model_name="stub",
    )
    localizer = MultimodalWindowLocalizer(
        transcript_localizer=transcript,
        frame_extractor=MissingFrameExtractor(),
        frame_scorer=StubFrameScorer(),
        transcript_weight=0.5,
    )

    result = localizer.localize_with_details(
        LocalizationRequest(
            question="How do I dress a wound?",
            video_id="video",
            duration_seconds=20,
        )
    )

    assert result.used_visual_evidence is False
    assert result.segment.start_seconds == 0


def test_local_video_repository_rejects_path_traversal(tmp_path: Path) -> None:
    repository = LocalVideoRepository(tmp_path)

    try:
        repository.resolve("../video")
    except ValueError:
        pass
    else:
        raise AssertionError("video IDs must not escape the cache directory")


def test_clip_scorer_accepts_transformers_structured_feature_output() -> None:
    features = torch.asarray([[1.0, 2.0]])

    assert torch.equal(
        ClipFrameScorer._feature_tensor(SimpleNamespace(pooler_output=features)),
        features,
    )
    assert torch.equal(ClipFrameScorer._feature_tensor(features), features)


def test_evidence_extractor_creates_grounded_content_addressed_bundle(
    tmp_path: Path,
) -> None:
    store = EvidenceArtifactStore(tmp_path / "evidence")
    extractor = EvidenceExtractor(
        transcript_repository=StubTranscriptRepository(),
        frame_extractor=StubFrameExtractor(),
        clip_extractor=StubClipExtractor(),
        store=store,
        frames_per_bundle=2,
    )

    bundle = extractor.extract(
        EvidenceExtractionRequest(
            question="How do I apply a sling?",
            video_id="video",
            source_uri="https://example.test/video",
            start_seconds=10,
            end_seconds=20,
            localization_model="test-localizer",
            scores={"fusion": 0.8},
            provenance={"test": True},
        )
    )

    assert [cue.text for cue in bundle.transcript] == ["apply arm sling"]
    assert len(bundle.frames) == 2
    assert bundle.clip.duration_seconds == 10
    assert bundle.provenance["contains_gold_timestamps"] is False
    assert store.manifest_path(bundle.bundle_id).is_file()
    assert all((store.root / frame.artifact_path).is_file() for frame in bundle.frames)
    assert (store.root / bundle.clip.artifact_path).is_file()


def test_evidence_bundle_id_is_deterministic(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path / "evidence")
    extractor = EvidenceExtractor(
        transcript_repository=StubTranscriptRepository(),
        frame_extractor=StubFrameExtractor(),
        clip_extractor=StubClipExtractor(),
        store=store,
        frames_per_bundle=1,
    )
    request = EvidenceExtractionRequest(
        question="How do I dress a wound?",
        video_id="video",
        source_uri="https://example.test/video",
        start_seconds=0,
        end_seconds=10,
        localization_model="test-localizer",
    )

    first = extractor.extract(request)
    second = extractor.extract(request)

    assert first.bundle_id == second.bundle_id
    assert first.clip.sha256 == second.clip.sha256


def test_end_to_end_pipeline_selects_jointly_supported_candidate(
    tmp_path: Path,
) -> None:
    catalog = VideoCatalog(
        (
            VideoDocument(
                video_id="other",
                title="Other procedure",
                duration_seconds=30,
                source_uri="https://example.test/other",
            ),
            VideoDocument(
                video_id="video",
                title="Wound and sling procedure",
                duration_seconds=30,
                source_uri="https://example.test/video",
            ),
        )
    )
    evidence_extractor = EvidenceExtractor(
        transcript_repository=StubTranscriptRepository(),
        frame_extractor=StubFrameExtractor(),
        clip_extractor=StubClipExtractor(),
        store=EvidenceArtifactStore(tmp_path / "evidence"),
        frames_per_bundle=1,
    )
    pipeline = EndToEndMedicalPipeline(
        video_retriever=StubEndToEndRetriever(),
        video_catalog=catalog,
        temporal_localizer=StubEndToEndLocalizer(),
        evidence_extractor=evidence_extractor,
        top_k=2,
        retrieval_weight=0.5,
    )

    result = pipeline.run("How do I apply a sling?")

    assert result.status == "answered"
    assert result.selected_video_id == "video"
    assert result.evidence is not None
    assert result.evidence.video_id == "video"
    assert len(result.attempts) == 2


def test_end_to_end_configuration_selection_rejects_test_summaries() -> None:
    validation = {
        "split": "validation",
        "retrieval_weight": 0.25,
        "localization_weight": 0.75,
        "selected_video_accuracy": 0.2,
        "end_to_end_localization": {
            "mean_iou": 0.1,
            "r_at_1_iou_0.5": 0.05,
        },
    }
    weaker = {
        **validation,
        "retrieval_weight": 0.5,
        "localization_weight": 0.5,
        "end_to_end_localization": {
            "mean_iou": 0.08,
            "r_at_1_iou_0.5": 0.06,
        },
    }

    selection = select_validation_configuration([weaker, validation])

    assert selection["selected_retrieval_weight"] == 0.25
    try:
        select_validation_configuration([{**validation, "split": "test"}])
    except ValueError as exc:
        assert "validation" in str(exc)
    else:
        raise AssertionError("test summaries must never select configuration")


def test_transcript_localization_report_keeps_missing_transcripts_as_failures() -> None:
    report = localization_report(
        [
            {
                "expected_video_id": "available",
                "expected_start": 0,
                "expected_end": 10,
                "predicted_video_id": "available",
                "predicted_start": 0,
                "predicted_end": 10,
                "transcript_available": True,
            },
            {
                "expected_video_id": "missing",
                "expected_start": 0,
                "expected_end": 10,
                "predicted_video_id": None,
                "predicted_start": None,
                "predicted_end": None,
                "transcript_available": False,
            },
        ]
    )

    assert report["transcript_coverage"] == 0.5
    assert report["all_samples"]["mean_iou"] == 0.5
    assert report["transcript_available_samples"]["mean_iou"] == 1
