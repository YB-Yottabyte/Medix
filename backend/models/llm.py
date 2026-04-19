"""
AI Model Handler - Supports multiple free AI providers
"""

import os
import re

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
            return self._format_response_markdown(self._generate_groq(query, context))
        if self.provider == "ollama":
            return self._format_response_markdown(self._generate_ollama(query, context))
        if self.provider == "huggingface":
            return self._format_response_markdown(self._generate_huggingface(query, context))
        return "Error: Unknown AI provider"

    def generate_multimodal_response(self, query: str, context: str) -> str:
        """Generate a conversational multimodal response (text + image context)."""
        if self.provider == "groq":
            return self._format_response_markdown(self._generate_groq_multimodal(query, context))
        # Fallback to default for other providers
        return self.generate_response(query, context)

    @staticmethod
    def _format_response_markdown(response_text: str) -> str:
        """Bold headings and urgent safety phrases for more scannable UI output."""
        if not response_text or response_text.startswith("Error"):
            return response_text

        formatted = response_text

        for heading in ("Analysis", "Steps", "Video"):
            formatted = re.sub(
                rf"(?m)^{heading}$",
                f"**{heading}**",
                formatted,
            )

        urgent_patterns = [
            r"CALL 911 IMMEDIATELY",
            r"Call 911 immediately",
            r"go to the hospital",
            r"seek emergency care",
            r"seek urgent medical attention",
            r"heavy bleeding",
            r"signs of shock",
        ]

        for pattern in urgent_patterns:
            formatted = re.sub(
                rf"(?<!\*)\b({pattern})\b(?!\*)",
                r"**\1**",
                formatted,
                flags=re.IGNORECASE,
            )

        return formatted

    def _create_system_prompt(self) -> str:
        """Create system prompt for medical Q&A"""
        return """You are a clear, professional medical guide. Your role is to provide accurate, step-by-step medical guidance based on the video transcript provided.

IMPORTANT RULES:
1. Do NOT start with filler phrases like "Stay calm", "Don't worry", "I'm here to guide you", or any calming opener. Jump straight into the answer.
2. NEVER use casual greetings like "Hey there!" or "Great question!"
3. Be direct and professional — get to the point immediately.

FORMATTING RULES:
- DO NOT use bullet points with dashes or asterisks
- Use numbered steps (1, 2, 3...) for procedures
- Use clear paragraph breaks between sections
- Write in complete, flowing sentences
- Use these section headings exactly when they fit the answer:
  Analysis
  Steps
  Video
- Bold only the most important headings or urgent safety phrases using markdown when helpful
- Do NOT include raw YouTube video IDs or raw second-based timestamps in the user-facing text unless the user explicitly asks for them.

RESPONSE STRUCTURE:
1. Analysis: brief professional summary of the condition or procedure
2. Steps: clear numbered step-by-step instructions based on the transcript
3. Video: optional brief line such as "A verified MedVidQA video is available in the player." Do not include IDs or raw metadata.
4. Important safety reminders only if they are supported by the transcript or clearly necessary

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

Guidelines:
- Jump straight into the answer — NO calming openers or filler phrases
- Use numbered steps (1, 2, 3) — NOT bullet points or asterisks
- Include safety reminders
- Prefer this structure:
  Analysis
  Steps
  Video
- Use markdown bold sparingly for the section headings and any urgent warning that the user must notice
- Do NOT mention YouTube video IDs or raw second-based timestamps unless the user explicitly asks for them.
- Do NOT add a separate metadata sentence like "This follows procedure X (YouTube video ID ...)".

Your direct, transcript-grounded response:"""

    def _create_multimodal_system_prompt(self) -> str:
        """System prompt for professional multimodal responses."""
        return """You are a professional first-aid assistant.

    PRIMARY GOAL:
    Answer the user's exact question clearly and directly using both text question and image findings.

    TONE:
    1. Professional, calm, and direct.
    2. Keep language simple, concrete, and actionable.
    3. Avoid filler phrases and avoid sounding casual.
    4. Do not use emojis.

    SAFETY:
    1. Give first-aid guidance only.
    2. Do not claim certainty from image alone.
    3. Include clear 'what to avoid' items relevant to this specific injury.
    4. If severe/emergency signs appear, advise urgent care.

    REQUIRED OUTPUT STRUCTURE:
    1. Start with the heading: Analysis
    2. Then give 1-3 concise sentences describing what the image appears to show and answer the user's main question.
    3. Then add the heading: Steps
    4. Then give 3-4 numbered action steps.
    5. Then add the heading: Video
    6. Then give at most one short sentence such as "A verified MedVidQA video is available in the player." Do not include IDs or raw timestamps.
    7. Use markdown bold for the three headings and for urgent warnings when appropriate.

    LENGTH:
    Keep total response concise and scan-friendly.

    IMPORTANT:
    Make the steps specific to the detected condition and the user's ask.
    Do not give generic advice unless it truly matches the context.
    If hospital care may be needed, say so clearly in the Analysis section with concrete red flags."""

    def _create_multimodal_user_prompt(self, query: str, context: str) -> str:
        """User prompt that enforces image + text grounding."""
        return f"""Use the following multimodal context and answer in the requested style.

CONTEXT:
{context}

USER QUESTION:
{query}

REQUIREMENTS:
1. Directly answer the exact user question.
2. Use BOTH the image findings and transcript/procedure context.
3. Include specific immediate actions.
4. Use the section headings exactly as:
Analysis
Steps
Video
5. Keep it professional and non-generic.
6. DO NOT include any line that starts with: You said:
7. Keep Steps to 3-4 concise numbered steps.
8. If the user asks "Should I go to hospital?", answer it clearly in the Analysis section.
9. Prefer concrete words over vague phrases.
10. Do NOT include YouTube video IDs, raw timestamps, or a separate metadata line in the answer unless the user explicitly asks for them.
11. Use markdown bold for headings and urgent warning phrases when helpful.

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
