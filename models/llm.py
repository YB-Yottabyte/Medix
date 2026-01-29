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
        return """You are a calm, reassuring medical guide helping people in potentially stressful situations. Your role is to provide clear, step-by-step medical guidance while keeping people calm and confident.

IMPORTANT TONE & APPROACH:
1. Start with a CALMING, CONTEXT-APPROPRIATE opener based on the question:
   - For emergencies (bleeding, choking, CPR, shock): "Stay calm, I'm here to guide you through this."
   - For first aid (burns, sprains, cuts): "Don't worry, you can handle this. Let me walk you through it."
   - For medical procedures (injections, wound care): "This is straightforward. I'll guide you step by step."
   - For vertigo/dizziness treatments: "I understand this can be unsettling. Let's go through this together."
   - For general medical questions: "I'm here to help. Let me explain this clearly."
   
2. NEVER use casual greetings like "Hey there!" or "Great question!" - these situations may be emergencies
3. Match your opening to the URGENCY and NATURE of the question
4. Be warm but professional - people may be scared or in crisis
5. Give confidence: "This is simpler than it looks" or "You're doing the right thing by learning this"

FORMATTING RULES:
- DO NOT use asterisks (*) or markdown formatting
- DO NOT use bullet points with dashes or asterisks  
- Use numbered steps (1, 2, 3...) for procedures
- Use clear paragraph breaks between sections
- Write in complete, flowing sentences

RESPONSE STRUCTURE:
1. Start with a CONTEXT-APPROPRIATE CALMING opener (match it to the question type)
2. Brief overview in 1-2 reassuring sentences
3. Clear numbered step-by-step instructions
4. Important safety reminders
5. End with reassurance matching the situation

TONE: Calm, confident, supportive. Like a composed paramedic or nurse talking someone through a situation - reassuring but clear."""
    
    def _create_user_prompt(self, query: str, context: str) -> str:
        """Create user prompt with context"""
        return f"""Here's the medical procedure information from our database:

{context}

The user is asking: "{query}"

Please provide a calm, reassuring response following these guidelines:
- Start with a CONTEXT-APPROPRIATE CALMING opener that matches the question type and urgency
  (e.g., "Stay calm" for emergencies, "Don't worry" for first aid, "This is straightforward" for routine procedures)
- Explain the procedure clearly and confidently
- Use numbered steps (1, 2, 3) - NOT bullet points or asterisks
- Include safety reminders
- End with reassurance appropriate to the situation
- DO NOT use any asterisks (*) or markdown formatting
- Write like a calm paramedic or medical professional guiding someone through the situation

Your calm, context-appropriate response:"""
    
    def _generate_groq(self, query: str, context: str) -> str:
        """Generate response using Groq API (Free)"""
        api_key = self.groq_config.get('api_key')
        
        if not api_key:
            return "❌ Error: Groq API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://console.groq.com/keys"
        
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
                return f"❌ Error calling Groq API: {response.status_code} - {error_detail}\n\nTip: Try regenerating your API key at https://console.groq.com/keys"
            
            result = response.json()
            return result['choices'][0]['message']['content']
        except requests.exceptions.RequestException as e:
            return f"❌ Error calling Groq API: {str(e)}"
        except Exception as e:
            return f"❌ Error: {str(e)}"
    
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
            return "❌ Error: Cannot connect to Ollama. Make sure Ollama is running locally.\nInstall from: https://ollama.ai\nThen run: ollama pull llama3.1"
        except requests.exceptions.RequestException as e:
            return f"❌ Error calling Ollama: {str(e)}"
        except Exception as e:
            return f"❌ Error: {str(e)}"
    
    def _generate_huggingface(self, query: str, context: str) -> str:
        """Generate response using Hugging Face Inference API"""
        api_key = self.hf_config.get('api_key')
        
        if not api_key:
            return "❌ Error: Hugging Face API key not configured. Please add your API key to config.yaml.\nGet a free key at: https://huggingface.co/settings/tokens"
        
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
            return f"❌ Error calling Hugging Face API: {str(e)}"
        except Exception as e:
            return f"❌ Error: {str(e)}"

    def transcribe_audio(self, audio_path: str) -> str:
        """Transcribe audio using Groq Whisper API"""
        try:
            from groq import Groq
            
            client = Groq(api_key=self.groq_config['api_key'])
            
            with open(audio_path, 'rb') as audio_file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-large-v3",
                    file=audio_file,
                    response_format="text"
                )
            
            return transcription.strip()
            
        except Exception as e:
            raise Exception(f"Transcription failed: {str(e)}")
