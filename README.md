# 🏥 Medical Video Q&A System

<div align="center">

**AI-Powered Medical Q&A with Video-Based Answers**

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Flask](https://img.shields.io/badge/Flask-3.0-green.svg)](https://flask.palletsprojects.com/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![Groq](https://img.shields.io/badge/Groq-Llama_3.3_70B-orange.svg)](https://groq.com/)

*Thesis Project: AI-assisted medical education using real medical procedure videos*

[Quick Start](#-quick-start) • [Features](#-features) • [Architecture](#-architecture)

</div>

---

## 📖 About

An intelligent medical Q&A system that retrieves and presents real medical procedure videos with AI-generated contextual answers. Built on the **MedVidQA dataset** (TREC 2024), this system combines semantic search with Llama 3.3 70B to provide accurate, video-based medical guidance.

### Key Innovation
- **319 verified medical procedure videos** from YouTube
- **Video-first answers** with embedded playback
- **Fast AI responses** using Groq's Llama 3.3 70B (70 tokens/second)
- **Semantic retrieval** via sentence transformers
- **Modern dual interface** (Flask + Next.js)

---

## ✨ Features

✅ **Real Medical Videos** - 319 verified YouTube videos from MedVidQA dataset  
✅ **Fast AI Responses** - Groq's Llama 3.3 70B (70 tokens/second)  
✅ **Semantic Search** - Sentence transformer embeddings for accurate retrieval  
✅ **Video Playback** - Embedded YouTube player with relevant procedures  
✅ **Modern UI** - Responsive Flask + Next.js interface  
✅ **Step-by-Step Answers** - AI-generated procedural guidance  
✅ **Contextual Responses** - RAG-based answers using retrieved videos  

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- Node.js 18+ (for Next.js frontend)
- Groq API Key (free at https://console.groq.com/keys)

### Installation

**1. Clone & Install Python Dependencies**
```bash
pip install -r requirements.txt
```

**2. Configure API Key**
```bash
# Create .env file or edit config.yaml
echo "GROQ_API_KEY=your-key-here" > .env
```

**3. Build Database (if needed)**
```bash
# Verify available videos
python scripts/verify_videos.py

# Build embeddings database
python scripts/build_database.py
```

**4. Run Backend**
```bash
python app.py
# Server starts at http://localhost:8080
```

**5. Run Frontend (Optional)**
```bash
cd frontend
npm install
npm run dev
# Frontend starts at http://localhost:3000
```

---

## 🎯 Usage

### Example Queries
- "How to perform CPR?"
- "Steps for wound care and dressing"
- "How to administer insulin injection?"
- "What is the procedure for blood pressure measurement?"
- "How to insert a nasogastric tube?"

### System Response
The system retrieves relevant medical videos and generates contextual answers with:
- **Video embedded** for visual learning
- **Step-by-step procedure** breakdown
- **AI-generated context** based on retrieved content
- **Multiple relevant videos** ranked by similarity

---

## ⚙️ Configuration

### `config.yaml` Structure

```yaml
ai:
  provider: 'groq'
  model: 'llama-3.3-70b-versatile'
  groq:
    api_key: 'your-groq-api-key'
    temperature: 0.3
    max_tokens: 1024

database:
  embedding_model: 'sentence-transformers/all-MiniLM-L6-v2'
  top_k: 5                    # Number of videos to retrieve
  similarity_threshold: 0.3   # Minimum relevance score

web:
  host: '0.0.0.0'
  port: 8080
  debug: false
```

---

## 📁 Project Structure

```
medical-qa-system/
├── app.py                         # Flask backend server
├── config.yaml                    # System configuration
├── requirements.txt               # Python dependencies
│
├── database/
│   ├── medical_db.py             # Database loader
│   └── retriever.py              # Semantic search engine
│
├── models/
│   ├── llm.py                    # Groq AI handler
│   └── generator.py              # RAG response generator
│
├── data/
│   ├── verified_medvidqa_videos.json    # 319 verified videos
│   └── cache_medvidqa_verified/         # Embeddings & procedures
│
├── MedVidQA/
│   ├── train.json                # Original dataset splits
│   ├── val.json
│   └── test.json
│
├── scripts/
│   ├── verify_videos.py          # Check video availability
│   └── build_database.py         # Build embeddings cache
│
├── templates/
│   └── index_video.html          # Flask UI
│
└── frontend/                      # Next.js frontend (optional)
    └── src/app/
        └── page.tsx              # Main page component
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
