# Medical Video Q&A System

<div align="center">

**AI-Powered Medical Q&A with Video-Based Answers**

[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![Flask](https://img.shields.io/badge/Flask-3.0-green.svg)](https://flask.palletsprojects.com/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![Groq](https://img.shields.io/badge/Groq-Llama_3.3_70B-orange.svg)](https://groq.com/)

_Thesis Project: AI-assisted medical education using real medical procedure videos with comprehensive dataset_

[Quick Start](#-quick-start) • [Features](#-features) • [Architecture](#️-architecture)

</div>

---

## 📖 About

An intelligent medical Q&A system that retrieves and presents real medical procedure videos with AI-generated contextual answers. Built on the **MedVidQA dataset** (TREC 2024), this system combines semantic search with Llama 3.3 70B to provide accurate, video-based medical guidance.

### Key Innovation

- **784 verified medical procedure videos** from YouTube
- **2,714 medical Q&A pairs** covering comprehensive procedures
- **Video-first answers** with embedded playback
- **Fast AI responses** using Groq's Llama 3.3 70B (70 tokens/second)
- **Semantic retrieval** via sentence transformers
- **Modern dual interface** (Flask + Next.js)

---

## ✨ Features

• **Real Medical Videos** - 784 verified YouTube videos from MedVidQA dataset  
• **Comprehensive Coverage** - 2,714 medical Q&A pairs spanning diverse procedures
• **Fast AI Responses** - Groq's Llama 3.3 70B (70 tokens/second)  
• **Semantic Search** - Sentence transformer embeddings for accurate retrieval  
• **Video Playback** - Embedded YouTube player with relevant procedures  
• **Modern UI** - Responsive Flask + Next.js interface  
• **Step-by-Step Answers** - AI-generated procedural guidance  
• **Contextual Responses** - RAG-based answers using retrieved videos

---

## 🔧 Tech Stack

**Backend:**

- Python 3.8+
- Flask 3.0
- Sentence Transformers
- NumPy, PyYAML

**Frontend:**

- Next.js 15
- React 19
- TailwindCSS
- TypeScript

**AI:**

- Groq (Llama 3.3 70B)
- all-MiniLM-L6-v2 (embeddings)

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
  provider: "groq"
  model: "llama-3.3-70b-versatile"
  groq:
    api_key: "your-groq-api-key"
    temperature: 0.3
    max_tokens: 1024

database:
  embedding_model: "sentence-transformers/all-MiniLM-L6-v2"
  top_k: 5 # Number of videos to retrieve
  similarity_threshold: 0.3 # Minimum relevance score

web:
  host: "0.0.0.0"
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
├── README.md                      # Project documentation
├── UPDATE_SUMMARY.md              # Dataset upgrade documentation
│
├── database/
│   ├── medical_db.py             # Database loader
│   └── retriever.py              # Semantic search engine
│
├── models/
│   ├── llm.py                    # Groq AI handler
│   └── generator.py              # RAG response generator
│
├── static/
│   ├── css/
│   │   └── styles.css            # Application styles
│   └── js/
│       └── app.js                # Frontend JavaScript logic
│
├── data/
│   ├── verified_medvidqa_videos.json    # 2,714 Q&A pairs from 784 videos
│   ├── cache_medvidqa_verified/         # Embeddings & procedures (2,714 vectors)
│   └── backup_20260129_120227/          # Safety backup of old system
│
├── MedVidQA/
│   ├── train.json                # Original dataset splits (2,710 entries)
│   ├── val.json                  # Validation set (145 entries)
│   └── test.json                 # Test set (155 entries)
│
├── scripts/
│   ├── build_database.py         # Build embeddings cache
│   ├── verify_all_videos.py      # Complete video verification system
│   └── update_system.py          # System update automation
│
├── templates/
│   └── index_video.html          # Flask UI template (updated with 784 videos)
│
└── frontend/                      # Next.js frontend (optional)
    └── src/app/
        └── page.tsx              # Main page component (updated stats)
```

---

## 🏗️ Architecture

### System Components

1. **Frontend Layer**
   - Flask template (video playback UI)
   - Next.js React app (modern interface)

2. **Backend Layer**
   - Flask REST API (`/api/query_video`)
   - Semantic retrieval engine
   - RAG response generator

3. **AI Layer**
   - Groq API (Llama 3.3 70B)
   - Sentence transformers (embeddings)

4. **Data Layer**
   - MedVidQA dataset (784 videos, 2,714 Q&A pairs)
   - Pre-computed embeddings cache (2,714 vectors)
   - Video metadata & comprehensive procedure annotations

### Workflow

```
User Query → Embedding → Semantic Search → Top-K Videos →
RAG Context → Llama 3.3 → Answer + Videos → UI Display
```

---

## 📊 Dataset

**MedVidQA** (TREC 2024)

- **784 verified videos** from YouTube (87% of original dataset)
- **2,714 question-answer pairs** covering comprehensive medical procedures
- **Medical procedures** spanning ACL recovery, knee exercises, neck stretches, breathing techniques, first aid, physical therapy, and more
- **Quality filtered** for availability and relevance
- **Comprehensive coverage** from train.json, val.json, test.json splits

---

## 📄 License

MIT License

---

<div align="center">

**CSE 492 Thesis Project - Spring 2026**  
_AI-Powered Medical Video Q&A System_

</div>

