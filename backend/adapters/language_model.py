"""Language-model provider adapter."""

import os

import requests


def get_groq_chat_api_key(config) -> str:
    return (
        os.environ.get("GROQ_CHAT_API_KEY")
        or os.environ.get("GROQ_API_KEY")
        or config.get("ai", {}).get("groq", {}).get("api_key", "")
    )


class AIHandler:
    def __init__(self, config):
        self.config = config
        self.provider = config["ai"]["provider"]

        if self.provider == "groq":
            self.groq_config = config["ai"]["groq"]
        elif self.provider == "ollama":
            self.ollama_config = config["ai"]["ollama"]
        elif self.provider == "huggingface":
            self.hf_config = config["ai"]["huggingface"]

    def generate_response(self, query: str, context: str) -> str:
        """Generate response using configured AI provider"""
        if self.provider == "groq":
            return self._generate_groq(query, context)
        if self.provider == "ollama":
            return self._generate_ollama(query, context)
        if self.provider == "huggingface":
            return self._generate_huggingface(query, context)
        return "Error: Unknown AI provider"

    def generate_multimodal_response(self, query: str, context: str) -> str:
        """Generate a conversational multimodal response (text + image context)."""
        if self.provider == "groq":
            return self._generate_groq_multimodal(query, context)
        # Fallback to default for other providers
        return self.generate_response(query, context)

    def _create_system_prompt(self) -> str:
        """Create system prompt for medical Q&A"""
        return """You are a medical-procedure information assistant for a research prototype. Your role is to summarize only the supplied instructional-video evidence.

IMPORTANT RULES:
1. Do NOT start with filler phrases like "Stay calm", "Don't worry", "I'm here to guide you", or any calming opener. Jump straight into the answer.
2. NEVER use casual greetings like "Hey there!" or "Great question!"
3. Be direct and professional — get to the point immediately.
4. Do not diagnose, prescribe, choose a medication or dosage, or claim that an observed action is clinically correct.
5. Do not add medical facts, safety warnings, or procedural steps that are absent from the supplied evidence.
6. If the evidence is incomplete or contradictory, explicitly say what cannot be determined.

FORMATTING RULES:
- DO NOT use asterisks (*) or markdown formatting
- DO NOT use bullet points with dashes or asterisks
- Use numbered steps (1, 2, 3...) for procedures
- Use clear paragraph breaks between sections
- Write in complete, flowing sentences

RESPONSE STRUCTURE:
1. Brief one-sentence overview of the procedure
2. Clear numbered step-by-step instructions (based on video transcript)
3. Safety reminders only when they appear in the supplied evidence
4. One closing sentence

TONE: Professional, clear, concise. Like a medical textbook — informative and direct."""

    def _create_user_prompt(self, query: str, context: str) -> str:
        """Create user prompt with context"""
        return f"""Here is ONE medical procedure from our database with its video transcript:

{context}

The user is asking: "{query}"

CRITICAL RULES:
1. Base your ENTIRE answer on the PRIMARY PROCEDURE transcript above. Do NOT use information from the "Related procedures" section.
2. Do NOT make up steps or information that is not in the transcript.
3. Summarize what the instructor actually says and does in ONE video only.
4. Mention the video timing once (e.g., "as shown in the video from 0:15 to 2:05").
5. Give ONE coherent set of numbered steps — never two separate sets for different scenarios.
6. Every procedural step must be supported by the primary transcript.
7. If the transcript does not support the requested answer, state that the evidence is insufficient.

Guidelines:
- Jump straight into the answer — NO calming openers or filler phrases
- Use numbered steps (1, 2, 3) — NOT bullet points or asterisks
- Include safety reminders
- DO NOT use asterisks (*) or markdown formatting

Your direct, transcript-grounded response:"""

    def _create_multimodal_system_prompt(self) -> str:
        """System prompt for friend-like but safe multimodal responses."""
        return """You are a medical-procedure information assistant in a research prototype.

    PRIMARY GOAL:
    Summarize the supplied instructional evidence in relation to the user's question and uncertain image findings.

    TONE:
    1. Professional, direct, and calm.
    2. Keep language simple and concrete.
    3. Clearly separate what the source supports from uncertain visual observations.

    SAFETY:
    1. Do not diagnose, prescribe, select medication or dosage, or determine that an action is clinically correct.
    2. Do not claim certainty from an image.
    3. Do not add steps, contraindications, or warning signs absent from the supplied evidence.
    4. If the context flags an emergency, direct the user to local emergency services.
    5. If the evidence is insufficient or conflicting, say so rather than completing it from memory.

    REQUIRED OUTPUT STRUCTURE:
    1. Line 1 must directly answer the user's main question in one sentence.
    2. Next identify the retrieved instructional source and timestamp.
    3. Then provide only the numbered actions supported by that source.
    4. End with any uncertainty or limitation that affects the answer.

    LENGTH:
    Keep total response short and scan-friendly (about 90-140 words).

    IMPORTANT:
    The visual findings are model-generated hypotheses, not diagnoses. The retrieved transcript is the procedural evidence."""

    def _create_multimodal_user_prompt(self, query: str, context: str) -> str:
        """User prompt that enforces image + text grounding."""
        return f"""Use the following multimodal context and answer in the requested style.

CONTEXT:
{context}

USER QUESTION:
{query}

REQUIREMENTS:
1. Answer only from the primary retrieved procedure and transcript.
2. Treat image findings as uncertain context and never as a diagnosis.
3. Include only actions and warnings supported by the supplied evidence.
4. Mention the source video interval once.
5. If the question cannot be answered from the evidence, state that directly.
6. Do not decide whether hospital care is necessary; direct potential emergencies to local emergency services.
7. Use 3-4 concise numbered steps at most.
8. Do not output hidden reasoning or claim that the user performed a step correctly.

Now produce the final response."""

    def _generate_groq(self, query: str, context: str) -> str:
        """Generate response using Groq API (Free)"""
        api_key = get_groq_chat_api_key(self.config)

        if not api_key:
            return "Error: Groq API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://console.groq.com/keys"

        url = "https://api.groq.com/openai/v1/chat/completions"

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        data = {
            "model": self.groq_config["model"],
            "messages": [
                {"role": "system", "content": self._create_system_prompt()},
                {"role": "user", "content": self._create_user_prompt(query, context)},
            ],
            "temperature": self.groq_config["temperature"],
            "max_tokens": self.groq_config["max_tokens"],
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=30)

            # Enhanced error reporting
            if response.status_code != 200:
                error_detail = response.text
                try:
                    error_json = response.json()
                    error_detail = error_json.get("error", {}).get("message", error_detail)
                except (ValueError, AttributeError):
                    pass
                return f"Error calling Groq API: {response.status_code} - {error_detail}\n\nTip: Try regenerating your API key at https://console.groq.com/keys"

            result = response.json()
            return result["choices"][0]["message"]["content"]
        except requests.exceptions.RequestException as e:
            return f"Error calling Groq API: {e!s}"
        except Exception as e:
            return f"Error: {e!s}"

    def _generate_groq_multimodal(self, query: str, context: str) -> str:
        """Generate multimodal response using Groq API with conversational style."""
        api_key = get_groq_chat_api_key(self.config)

        if not api_key:
            return "Error: Groq API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://console.groq.com/keys"

        url = "https://api.groq.com/openai/v1/chat/completions"

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        data = {
            "model": self.groq_config["model"],
            "messages": [
                {"role": "system", "content": self._create_multimodal_system_prompt()},
                {"role": "user", "content": self._create_multimodal_user_prompt(query, context)},
            ],
            "temperature": 0.45,
            "max_tokens": self.groq_config["max_tokens"],
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=30)

            if response.status_code != 200:
                error_detail = response.text
                try:
                    error_json = response.json()
                    error_detail = error_json.get("error", {}).get("message", error_detail)
                except Exception:
                    pass
                return f"Error calling Groq API: {response.status_code} - {error_detail}\n\nTip: Try regenerating your API key at https://console.groq.com/keys"

            result = response.json()
            return result["choices"][0]["message"]["content"]
        except requests.exceptions.RequestException as e:
            return f"Error calling Groq API: {e!s}"
        except Exception as e:
            return f"Error: {e!s}"

    def _generate_ollama(self, query: str, context: str) -> str:
        """Generate response using Ollama (Local, Free)"""
        url = f"{self.ollama_config['base_url']}/api/generate"

        prompt = f"""{self._create_system_prompt()}

{self._create_user_prompt(query, context)}"""

        data = {
            "model": self.ollama_config["model"],
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": self.ollama_config["temperature"]},
        }

        try:
            response = requests.post(url, json=data, timeout=60)
            response.raise_for_status()
            result = response.json()
            return result["response"]
        except requests.exceptions.ConnectionError:
            return "Error: Cannot connect to Ollama. Make sure Ollama is running locally.\nInstall from: https://ollama.ai\nThen run: ollama pull llama3.1"
        except requests.exceptions.RequestException as e:
            return f"Error calling Ollama: {e!s}"
        except Exception as e:
            return f"Error: {e!s}"

    def _generate_huggingface(self, query: str, context: str) -> str:
        """Generate response using Hugging Face Inference API"""
        api_key = self.hf_config.get("api_key")

        if not api_key:
            return "Error: Hugging Face API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://huggingface.co/settings/tokens"

        model = self.hf_config["model"]
        url = f"https://api-inference.huggingface.co/models/{model}"

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        prompt = f"""{self._create_system_prompt()}

{self._create_user_prompt(query, context)}"""

        data = {
            "inputs": prompt,
            "parameters": {
                "temperature": self.hf_config["temperature"],
                "max_new_tokens": self.hf_config["max_tokens"],
                "return_full_text": False,
            },
        }

        try:
            response = requests.post(url, headers=headers, json=data, timeout=60)
            response.raise_for_status()
            result = response.json()

            if isinstance(result, list) and len(result) > 0:
                return result[0].get("generated_text", str(result))
            return str(result)
        except requests.exceptions.RequestException as e:
            return f"Error calling Hugging Face API: {e!s}"
        except Exception as e:
            return f"Error: {e!s}"
