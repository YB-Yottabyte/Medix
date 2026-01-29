# 🏥 Medical Procedure Q&A System

<div align="center">

**AI-Powered Question Answering for Medical Procedures**

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Flask](https://img.shields.io/badge/Flask-3.0-green.svg)](https://flask.palletsprojects.com/)

*Built for family caregivers and community health aides performing essential medical procedures*

[Quick Start](#-quick-start) • [Features](#-features) • [Demo](#-demo) • [Configuration](#-configuration)

</div>

---

## 📖 About

This system provides AI-powered, step-by-step guidance for medical procedures through an intelligent question-answering interface. It combines **semantic search** with **retrieval-augmented generation (RAG)** to deliver accurate, personalized medical guidance based on the HiREST dataset (CVPR 2023).

### Use Case
Designed for:
- Family caregivers performing medication administration, wound care, and emergency procedures
- Community health aides in remote or resource-constrained environments  
- Training scenarios for medical procedure education
- Research in AI-assisted healthcare and augmented reality applications

---

## ✨ Features

✅ **Intelligent Retrieval** - Semantic search across medical procedure database  
✅ **AI-Powered Responses** - Context-aware answers using free AI APIs  
✅ **Dual Interface** - Beautiful web UI + terminal interface  
✅ **Multiple AI Providers** - Groq, Ollama, or Hugging Face  
✅ **Offline Capable** - Works with local Ollama (no internet needed)  
✅ **Step-by-Step Guidance** - Detailed procedural instructions with timing  
✅ **Safety-First** - Clear warnings and professional consultation reminders  

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8 or higher
- pip package manager

### Installation (3 steps)

**1. Install Dependencies**
```bash
cd medical-qa-system
pip install -r requirements.txt
```

**2. Setup Dataset**
```bash
python scripts/download_dataset.py
```

**3. Configure AI Provider (Choose one)**

**Option A: Groq (Recommended - Fast & Free)**
```bash
# 1. Get free API key: https://console.groq.com/keys
# 2. Edit config.yaml and add your key:
```
```yaml
ai:
  provider: 'groq'
  groq:
    api_key: 'your-groq-api-key-here'
```

**Option B: Ollama (Local - No API Key)**
```bash
# 1. Install Ollama: https://ollama.ai
# 2. Pull model:
ollama pull llama3.1

# 3. Edit config.yaml:
```
```yaml
ai:
  provider: 'ollama'
```

**4. Run the System**

**Web Interface:**
```bash
python app.py
# Open: http://localhost:5000
```

**Terminal Interface:**
```bash
python terminal_qa.py
```

---

## 🎯 Demo

### Try It Out
```bash
# Run demo to test the system
python demo.py
```

### Example Queries
- "How do I safely administer insulin?"
- "What are the steps for wound care?"
- "How to perform CPR on an adult?"
- "What should I check before giving medication?"
- "How to measure blood pressure correctly?"

### Sample Output
```
💡 ANSWER:
─────────────────────────────────────────────────────────
To safely administer insulin, follow these critical steps:

1. Verify the Insulin Type & Dose (15-30s)
   - Check prescription and insulin vial label
   - Confirm correct type and expiration date

2. Hand Hygiene (30-45s)
   - Wash hands thoroughly with soap and water
   - This prevents infection at injection site

3. Prepare the Insulin (45-60s)
   - Roll vial gently (don't shake)
   - Clean vial top with alcohol swab
...
```

---

## ⚙️ Configuration

### AI Providers Comparison

| Provider | Speed | Cost | Internet | Setup |
|----------|-------|------|----------|-------|
| **Groq** | ⚡⚡⚡ Very Fast | Free | Required | API Key |
| **Ollama** | ⚡⚡ Fast | Free | Not Required | Local Install |
| **Hugging Face** | ⚡ Moderate | Free | Required | API Key |

### Database Settings (`config.yaml`)
```yaml
database:
  embedding_model: 'all-MiniLM-L6-v2'  # Sentence transformer model
  top_k: 5                              # Number of procedures to retrieve
  similarity_threshold: 0.3             # Minimum relevance score (0-1)
```

### Web Server Settings
```yaml
web:
  host: '0.0.0.0'    # Listen on all interfaces
  port: 5000         # Port number
  debug: true        # Enable debug mode
```

---

## 📁 Project Structure

```
medical-qa-system/
├── 📱 app.py                      # Flask web application
├── 💻 terminal_qa.py              # Terminal interface
├── 🎬 demo.py                     # Quick demo script
├── ⚙️  config.yaml                 # Configuration file
├── 📋 requirements.txt            # Python dependencies
│
├── 🗄️  database/
│   ├── db_builder.py             # Build searchable database from HiREST
│   └── retriever.py              # Semantic search and retrieval
│
├── 🤖 models/
│   ├── ai_handler.py             # Multi-provider AI integration
│   └── response_generator.py    # RAG response generation
│
├── 📊 data/
│   ├── splits/                   # HiREST dataset annotations
│   └── cache/                    # Processed embeddings & database
│
├── 🎨 templates/
│   └── index.html                # Modern web UI
│
└── 🛠️  scripts/
    └── download_dataset.py       # Dataset setup utility
```

---

## 🔧 How It Works

```mermaid
User Query → Semantic Search → Retrieve Procedures → AI Generation → Response
```

1. **User Query**: Question about medical procedure
2. **Semantic Search**: Find relevant procedures using embeddings
3. **Retrieval**: Extract step-by-step instructions from database
4. **AI Generation**: Generate personalized response with context
5. **Response**: Clear, actionable guidance with safety notes

### Technology Stack
- **Backend**: Flask (Python)
- **Embeddings**: Sentence-Transformers (MiniLM)
- **AI Models**: Groq/Ollama/Hugging Face APIs
- **Frontend**: Vanilla JavaScript, Modern CSS
- **Database**: HiREST dataset (CVPR 2023)

---

## 📚 Dataset Information

Based on **HiREST** (Hierarchical Retrieval and Step-captioning)
- Published at CVPR 2023
- Hierarchical video-moment retrieval dataset
- Step-by-step procedure annotations with timestamps

Current demo includes 5 sample medical procedures:
- ✅ Medication Administration
- ✅ Wound Care Management  
- ✅ CPR (Adult)
- ✅ Blood Pressure Measurement
- ✅ Insulin Injection

---

## 🎓 Research Applications

This project demonstrates key concepts for AI-assisted healthcare:

1. **Retrieval-Augmented Generation (RAG)** - Combining database search with LLM generation
2. **Multimodal Understanding** - Foundation for video + text analysis
3. **Healthcare AI** - Safe, responsible AI for medical guidance
4. **Hands-Free Interaction** - Ready for AR/VR adaptation

### Future AR Integration (Meta Quest 3)
- ✅ Voice input/output
- ✅ Real-time video analysis
- ✅ Context-aware procedural guidance
- ✅ Egocentric video understanding
- ✅ Step recognition and tracking

---

## ⚠️ Important Safety Notice

**This system provides general guidance based on standard medical procedures.**

- ✋ Always consult licensed healthcare professionals for medical advice
- 🚨 In emergencies, call 911 or your local emergency number immediately
- 👨‍⚕️ Not a replacement for professional medical training or judgment
- 📖 For educational and assistive purposes only

---

## 🐛 Troubleshooting

### "No API key configured"
→ Add your API key to `config.yaml` or switch to Ollama (local)

### "Cannot connect to Ollama"  
→ Make sure Ollama is running: `ollama serve`

### "No relevant procedures found"
→ Try rephrasing your query or lower `similarity_threshold` in config

### Import errors
→ Reinstall dependencies: `pip install -r requirements.txt`

### Database not found
→ Run: `python scripts/download_dataset.py`

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- **HiREST Dataset**: Zala et al., CVPR 2023
- **EVA-CLIP**: BAAI Foundation
- **Sentence-Transformers**: UKPLab
- **Groq**: Fast inference API
- **Ollama**: Local LLM runtime

---

## 📧 Support

For questions about this project:
- Review the [Setup Guide](SETUP_GUIDE.md)
- Check configuration in `config.yaml`
- Run `python demo.py` to test components

---

<div align="center">

**Built for CSE 492 - Spring 2026**  
*AI-powered question answering for medical procedures*

⭐ Star this repo if you find it helpful!

</div>
