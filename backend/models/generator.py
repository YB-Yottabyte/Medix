"""
Response Generator - Combines retrieval and AI generation
"""

from backend.database.retriever import ProcedureRetriever
from backend.models.llm import AIHandler


class ResponseGenerator:
    def __init__(self, config, retriever: ProcedureRetriever, ai_handler: AIHandler):
        self.config = config
        self.retriever = retriever
        self.ai_handler = ai_handler

    @staticmethod
    def _is_provider_error(response_text: str) -> bool:
        """Detect provider failures so we can fall back to retrieval-only guidance."""
        if not response_text:
            return True
        error_prefixes = (
            "Error calling Groq API:",
            "Error: Groq API key not configured.",
            "Error calling Ollama:",
            "Error calling Hugging Face",
            "Error: Unknown AI provider",
            "Error:",
        )
        return response_text.startswith(error_prefixes)

    @staticmethod
    def _fallback_response(retrieved_procedures: list[dict]) -> str:
        """Return a simple transcript-grounded fallback when generation is unavailable."""
        if not retrieved_procedures:
            return (
                "I couldn't generate a full explanation right now, and I also couldn't find a "
                "verified MedVidQA procedure for this request."
            )

        top = retrieved_procedures[0]
        answer_start = int(top.get("answer_start", 0))
        answer_end = int(top.get("answer_end", 0))
        start_minutes, start_seconds = divmod(answer_start, 60)
        end_minutes, end_seconds = divmod(answer_end, 60)

        lines = [
            "Analysis",
            "",
            f"The closest verified MedVidQA procedure is \"{top.get('question', 'Unknown procedure')}\".",
            "",
            "Steps",
        ]

        steps = top.get("steps") or []
        if steps:
            for index, step in enumerate(steps, start=1):
                step_text = step.get("heading") or step.get("description") or f"Step {index}"
                lines.append(f"{index}. {step_text}")
        else:
            lines.append(
                f"1. Review the demonstrated procedure in the matched video segment from "
                f"{start_minutes}:{start_seconds:02d} to {end_minutes}:{end_seconds:02d}."
            )

        lines.extend(
            [
                "",
                "Video",
                "",
                f"Relevant segment: {start_minutes}:{start_seconds:02d} to {end_minutes}:{end_seconds:02d}.",
            ]
        )

        return "\n".join(lines)

    def generate(self, query: str) -> dict:
        """Generate response to user query"""

        # Step 1: Retrieve relevant procedures
        retrieved_procedures = self.retriever.search(query)

        # Step 2: Format context
        context = self.retriever.format_results_for_context(retrieved_procedures)

        # Step 3: Generate AI response
        ai_response = self.ai_handler.generate_response(query, context)
        if self._is_provider_error(ai_response):
            ai_response = self._fallback_response(retrieved_procedures)

        # Return structured response
        return {
            "query": query,
            "response": ai_response,
            "retrieved_procedures": retrieved_procedures,
            "num_procedures_found": len(retrieved_procedures),
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
