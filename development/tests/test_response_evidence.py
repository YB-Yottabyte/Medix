"""Regression tests for live passage ranking and complete citation boundaries."""

import unittest
from types import SimpleNamespace

import numpy as np
from scipy.sparse import csr_matrix

from backend.domain import TranscriptCue, VideoCandidate
from backend.temporal_localization.transcript import TranscriptWindowLocalizer
from backend.video_retrieval.transcript import TranscriptVideoRetriever


class ResponseEvidenceTests(unittest.TestCase):
    def test_live_clip_does_not_cut_off_the_interpretation_of_a_check(self):
        cues = (
            TranscriptCue(168.5, 5.92, "Press for five seconds."),
            TranscriptCue(174.42, 7.12, "Release; colour should return within two seconds."),
        )

        def localizer(complete):
            return TranscriptWindowLocalizer(
                repository=None,
                encoder=None,
                window_seconds=90,
                stride_seconds=45,
                embedding_model_name="test",
                complete_cue_boundaries=complete,
            )

        old = localizer(False)._build_windows(cues, 250)
        new = localizer(True)._build_windows(cues, 250)
        self.assertTrue(any(w.end_seconds == 180 for w in old))
        self.assertFalse(any(w.end_seconds == 180 for w in new))
        for window in new:
            for cue in cues:
                if cue.text in window.text:
                    self.assertLessEqual(window.start_seconds, cue.start_seconds)
                    self.assertGreaterEqual(window.end_seconds, cue.end_seconds)

    def test_a_video_cannot_combine_scores_from_two_unrelated_passages(self):
        retriever = object.__new__(TranscriptVideoRetriever)
        retriever.documents = ["broad-video", "direct-video"]
        retriever.metadata = SimpleNamespace(
            retrieve=lambda _query, **_kwargs: (
                VideoCandidate("broad-video", "Broad", 0),
                VideoCandidate("direct-video", "Direct", 0),
            )
        )
        retriever.encoder = SimpleNamespace(encode=lambda _query, **_kwargs: np.array([[1.0, 0.0]]))
        retriever._owners = ("broad-video", "broad-video", "direct-video")
        # Broad video's lexical and semantic matches are DIFFERENT passages.
        # Direct video's single passage is strong on both signals.
        retriever._embeddings = np.array([[1.0, 0.0], [0.0, 1.0], [0.8, 0.6]])
        retriever._lexical = SimpleNamespace(transform=lambda _query: csr_matrix([[1.0]]))
        retriever._lexical_bank = csr_matrix([[0.0], [1.0], [1.0]])
        ranked = retriever.retrieve("a medical information need", limit=2)
        self.assertEqual(ranked[0].video_id, "direct-video")
        self.assertGreater(ranked[0].retrieval_score, ranked[1].retrieval_score)


if __name__ == "__main__":
    unittest.main()
