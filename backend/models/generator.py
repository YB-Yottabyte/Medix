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

    def generate(self, query: str) -> dict:
        """Generate response to user query"""

        # Step 1: Retrieve relevant procedures
        retrieved_procedures = self.retriever.search(query)

        # Step 2: Format context
        context = self.retriever.format_results_for_context(retrieved_procedures)

        # Step 3: Generate AI response
        ai_response = self.ai_handler.generate_response(query, context)

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
