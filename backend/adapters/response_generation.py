"""Transcript-grounded response-generation adapter."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from backend.services.pipeline import ABSTENTION_MESSAGE, RetrievalGate

if TYPE_CHECKING:
    from backend.ports import LanguageModelPort, RetrieverPort


class ResponseGenerator:
    def __init__(
        self,
        config,
        retriever: RetrieverPort,
        ai_handler: LanguageModelPort,
    ):
        self.config = config
        self.retriever = retriever
        self.ai_handler = ai_handler
        self.retrieval_gate = RetrievalGate(
            config.get("safety", {}).get("answer_confidence_threshold", 0.35)
        )

    def generate(self, query: str) -> dict:
        """Generate a response only when retrieval passes the evidence gate."""
        started = time.monotonic()

        retrieval_started = time.monotonic()
        retrieved_procedures = self.retriever.search(query)
        retrieval_ms = int((time.monotonic() - retrieval_started) * 1000)
        decision = self.retrieval_gate.assess(retrieved_procedures)

        if not decision.answerable:
            return {
                "query": query,
                "response": ABSTENTION_MESSAGE,
                "status": "abstained",
                "answerable": False,
                "confidence": decision.confidence,
                "confidence_threshold": decision.threshold,
                "abstention_reason": decision.reason,
                "evidence": list(decision.evidence),
                "retrieved_procedures": retrieved_procedures,
                "num_procedures_found": len(retrieved_procedures),
                "metrics": {
                    "retrieval_ms": retrieval_ms,
                    "generation_ms": 0,
                    "total_ms": int((time.monotonic() - started) * 1000),
                },
            }

        context = self.retriever.format_results_for_context(retrieved_procedures)

        generation_started = time.monotonic()
        ai_response = self.ai_handler.generate_response(query, context)
        generation_ms = int((time.monotonic() - generation_started) * 1000)

        return {
            "query": query,
            "response": ai_response,
            "status": "answered",
            "answerable": True,
            "confidence": decision.confidence,
            "confidence_threshold": decision.threshold,
            "abstention_reason": None,
            "evidence": list(decision.evidence),
            "retrieved_procedures": retrieved_procedures,
            "num_procedures_found": len(retrieved_procedures),
            "metrics": {
                "retrieval_ms": retrieval_ms,
                "generation_ms": generation_ms,
                "total_ms": int((time.monotonic() - started) * 1000),
            },
        }

    def format_response_for_display(self, response_data: dict) -> str:
        """Format response for terminal/web display"""
        output = []

        output.append("╔" + "═" * 78 + "╗")
        output.append("║" + " " * 25 + "MEDICAL PROCEDURE Q&A" + " " * 32 + "║")
        output.append("╚" + "═" * 78 + "╝")
        output.append("")

        output.append("YOUR QUESTION:")
        output.append("─" * 80)
        output.append(response_data["query"])
        output.append("")

        output.append("ANSWER:")
        output.append("─" * 80)
        output.append(response_data["response"])
        output.append("")

        if response_data["retrieved_procedures"]:
            output.append("📚 RELEVANT PROCEDURES FROM DATABASE:")
            output.append("─" * 80)
            for i, proc in enumerate(response_data["retrieved_procedures"], 1):
                output.append(f"\n{i}. {proc['question']} (Match: {proc['similarity_score']:.0%})")
                if proc["steps"]:
                    output.append(f"   Total Steps: {len(proc['steps'])}")

        output.append("")
        output.append("IMPORTANT REMINDER:")
        output.append("─" * 80)
        output.append("This system provides general guidance. Always consult with healthcare")
        output.append("professionals for medical advice and emergency situations.")
        output.append("")

        return "\n".join(output)
