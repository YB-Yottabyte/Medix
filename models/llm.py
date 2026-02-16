"""
AI Model Handler - Supports multiple free AI providers
"""
import requests
import json
from typing import Dict, Optional

class AIHandler:
    def __init__(self, config):
        self.config = config
        self.provider = config['ai']['provider']
        
        if self.provider == 'groq':
            self.groq_config = config['ai']['groq']
        elif self.provider == 'ollama':
            self.ollama_config = config['ai']['ollama']
        elif self.provider == 'huggingface':
            self.hf_config = config['ai']['huggingface']
    
    def generate_response(self, query: str, context: str) -> str:
        """Generate response using configured AI provider"""
        if self.provider == 'groq':
            return self._generate_groq(query, context)
        elif self.provider == 'ollama':
            return self._generate_ollama(query, context)
        elif self.provider == 'huggingface':
            return self._generate_huggingface(query, context)
        else:
            return "Error: Unknown AI provider"
    
    def _create_system_prompt(self) -> str:
        """Create system prompt for medical Q&A"""
        return """You are a clear, professional medical guide. Your role is to provide accurate, step-by-step medical guidance based on the video transcript provided.

IMPORTANT RULES:
1. Do NOT start with filler phrases like "Stay calm", "Don't worry", "I'm here to guide you", or any calming opener. Jump straight into the answer.
2. NEVER use casual greetings like "Hey there!" or "Great question!"
3. Be direct and professional — get to the point immediately.

FORMATTING RULES:
- DO NOT use asterisks (*) or markdown formatting
- DO NOT use bullet points with dashes or asterisks  
- Use numbered steps (1, 2, 3...) for procedures
- Use clear paragraph breaks between sections
- Write in complete, flowing sentences

RESPONSE STRUCTURE:
1. Brief one-sentence overview of the procedure
2. Clear numbered step-by-step instructions (based on video transcript)
3. Important safety reminders
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

Guidelines:
- Jump straight into the answer — NO calming openers or filler phrases
- Use numbered steps (1, 2, 3) — NOT bullet points or asterisks
- Include safety reminders
- DO NOT use asterisks (*) or markdown formatting

Your direct, transcript-grounded response:"""
    
    def _generate_groq(self, query: str, context: str) -> str:
        """Generate response using Groq API (Free)"""
        api_key = self.groq_config.get('api_key')
        
        if not api_key:
            return "Error: Groq API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://console.groq.com/keys"
        
        url = "https://api.groq.com/openai/v1/chat/completions"
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        data = {
            "model": self.groq_config['model'],
            "messages": [
                {"role": "system", "content": self._create_system_prompt()},
                {"role": "user", "content": self._create_user_prompt(query, context)}
            ],
            "temperature": self.groq_config['temperature'],
            "max_tokens": self.groq_config['max_tokens']
        }
        
        try:
            response = requests.post(url, headers=headers, json=data, timeout=30)
            
            # Enhanced error reporting
            if response.status_code != 200:
                error_detail = response.text
                try:
                    error_json = response.json()
                    error_detail = error_json.get('error', {}).get('message', error_detail)
                except:
                    pass
                return f"Error calling Groq API: {response.status_code} - {error_detail}\n\nTip: Try regenerating your API key at https://console.groq.com/keys"
            
            result = response.json()
            return result['choices'][0]['message']['content']
        except requests.exceptions.RequestException as e:
            return f"Error calling Groq API: {str(e)}"
        except Exception as e:
            return f"Error: {str(e)}"
    
    def _generate_ollama(self, query: str, context: str) -> str:
        """Generate response using Ollama (Local, Free)"""
        url = f"{self.ollama_config['base_url']}/api/generate"
        
        prompt = f"""{self._create_system_prompt()}

{self._create_user_prompt(query, context)}"""
        
        data = {
            "model": self.ollama_config['model'],
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": self.ollama_config['temperature']
            }
        }
        
        try:
            response = requests.post(url, json=data, timeout=60)
            response.raise_for_status()
            result = response.json()
            return result['response']
        except requests.exceptions.ConnectionError:
            return "Error: Cannot connect to Ollama. Make sure Ollama is running locally.\nInstall from: https://ollama.ai\nThen run: ollama pull llama3.1"
        except requests.exceptions.RequestException as e:
            return f"Error calling Ollama: {str(e)}"
        except Exception as e:
            return f"Error: {str(e)}"
    
    def _generate_huggingface(self, query: str, context: str) -> str:
        """Generate response using Hugging Face Inference API"""
        api_key = self.hf_config.get('api_key')
        
        if not api_key:
            return "Error: Hugging Face API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://huggingface.co/settings/tokens"
        
        model = self.hf_config['model']
        url = f"https://api-inference.huggingface.co/models/{model}"
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        prompt = f"""{self._create_system_prompt()}

{self._create_user_prompt(query, context)}"""
        
        data = {
            "inputs": prompt,
            "parameters": {
                "temperature": self.hf_config['temperature'],
                "max_new_tokens": self.hf_config['max_tokens'],
                "return_full_text": False
            }
        }
        
        try:
            response = requests.post(url, headers=headers, json=data, timeout=60)
            response.raise_for_status()
            result = response.json()
            
            if isinstance(result, list) and len(result) > 0:
                return result[0].get('generated_text', str(result))
            return str(result)
        except requests.exceptions.RequestException as e:
            return f"Error calling Hugging Face API: {str(e)}"
        except Exception as e:
            return f"Error: {str(e)}"


