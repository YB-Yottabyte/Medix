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
            raw_response = self._generate_groq_multimodal(query, context)
            normalized = self._normalize_multimodal_response_style(raw_response)
            return self._format_response_markdown(normalized)
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

    @staticmethod
    def _normalize_multimodal_response_style(response_text: str) -> str:
        """
        Remove legacy multimodal section headings so image-assisted answers match
        the cleaner professional style used elsewhere in the app.
        """
        if not response_text or response_text.startswith("Error"):
            return response_text

        normalized = response_text.strip()

        normalized = re.sub(
            r"(?im)^\s*\*?\*?(Analysis|Steps|Video)\*?\*?\s*:?\s*$",
            "",
            normalized,
        )
        normalized = re.sub(
            r"(?im)^\s*A verified (MedVidQA|Medix) video is available in the player\.?\s*$",
            "",
            normalized,
        )
        normalized = re.sub(r"\n{3,}", "\n\n", normalized).strip()

        return normalized

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
        """System prompt for professional but human multimodal responses."""
        return """You are a clear, supportive medical guide.

PRIMARY GOAL:
Answer the user's exact question directly using both the selected image region and the retrieved medical procedure context.

IMPORTANT RULES:
1. Do NOT use headings like Analysis, Steps, or Video unless the user explicitly asks for sections.
2. Do NOT include a separate metadata line about the video player.
3. Do NOT mention YouTube IDs, raw timestamps, or backend metadata unless the user explicitly asks.
4. Do NOT use filler phrases, casual greetings, or emojis.
5. Do NOT claim certainty from the image alone. Use careful wording like "appears to show" when needed.

STYLE:
1. Sound like a real person helping the user, not a clinical report.
2. Professional, direct, warm, and concise.
3. If instructions are needed, present them as one numbered list.
4. Start with a brief natural explanation, then move straight into the steps.
5. Prefer phrases like "From what I can see" or "Here's what to do first" over detached phrasing like "The image appears to show" or "Based on the provided information".
6. Talk to the user directly using "you" when giving guidance.

SAFETY:
1. Give first-aid guidance only.
2. Include urgent care guidance only when clearly relevant.
3. Keep steps specific to the detected condition and the user's question.
4. Avoid generic advice when the image and retrieval context support something more specific."""

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
4. Keep it professional and non-generic.
5. DO NOT include any line that starts with: You said:
6. After the opening explanation, give 3-5 concise numbered steps when actionable instructions are needed.
7. If the user asks whether hospital care is needed, answer it clearly and directly in the opening explanation.
8. Prefer concrete words over vague phrases.
9. Do NOT include section headings like Analysis, Steps, or Video.
10. Do NOT include YouTube video IDs, raw timestamps, or a separate metadata sentence about the player.
11. Match the tone of a polished text-only medical response.
12. Make the opening sentence feel personal and natural, as if you are directly helping the user in the moment.
13. Avoid robotic lead-ins such as "The image appears to show", "Based on the provided information", or "It is not possible to determine with certainty" unless uncertainty itself is the key point.

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
