"""
Flask Web Application for Medical Procedure Q&A
"""
from flask import Flask, render_template, request, jsonify
import yaml
import os
from pathlib import Path
from database.medical_db import MedicalDatabase
from database.retriever import ProcedureRetriever
from models.llm import AIHandler
from models.generator import ResponseGenerator

app = Flask(__name__)

# Load configuration
config_path = os.path.join(os.path.dirname(__file__), 'config.yaml')
with open(config_path, 'r') as f:
    config = yaml.safe_load(f)

# Vercel environment variables override
if os.getenv('VERCEL'):
    # Override config for Vercel deployment
    config['web']['debug'] = False
    if os.getenv('GROQ_API_KEY'):
        config['ai']['groq']['api_key'] = os.getenv('GROQ_API_KEY')

# Initialize components
print("Initializing Medical Q&A System...")
print("=" * 60)

# Load or build database - Using VERIFIED MedVidQA dataset (real medical videos)
db = MedicalDatabase(config)
cache_dir = 'data/cache_medvidqa_verified'  # Use verified MedVidQA database

if Path(cache_dir).exists() and (Path(cache_dir) / 'procedures.pkl').exists():
    print("Loading Verified MedVidQA Database (319 real medical procedures)...")
    db.load(cache_dir)
else:
    print("❌ Verified MedVidQA database not found!")
    print("   Run: python scripts/build_database.py")
    exit(1)

# Initialize retriever, AI handler, and response generator
retriever = ProcedureRetriever(config, db)
ai_handler = AIHandler(config)
response_generator = ResponseGenerator(config, retriever, ai_handler)

print("\nSystem ready!")
print(f"   - Database: {len(db.procedures)} procedures loaded")
print(f"   - AI Provider: {config['ai']['provider']}")
print("=" * 60)

@app.route('/api/query', methods=['POST'])
def query():
    """Handle text-based query requests"""
    try:
        data = request.get_json()
        user_query = data.get('query', '').strip()
        
        if not user_query:
            return jsonify({'error': 'No query provided'}), 400
        
        # Generate response
        response_data = response_generator.generate(user_query)
        
        return jsonify(response_data)
        
    except Exception as e:
        print(f"Error in /api/query: {e}")
        return jsonify({'error': 'An internal error occurred.'}), 500

@app.route('/')
def index():
    """Render main page with video support"""
    return render_template('index_video.html')

@app.route('/api/query_video', methods=['POST'])
def query_video():
    """Handle video-enabled query requests"""
    try:
        data = request.get_json()
        user_query = data.get('query', '').strip()
        
        if not user_query:
            return jsonify({'error': 'No query provided'}), 400
        
        # Generate response
        response_data = response_generator.generate(user_query)
        
        # Find matching video from MedVidQA data
        video_url = None
        video_id = None
        answer_start = None
        answer_end = None
        video_steps = []
        
        if response_data['retrieved_procedures']:
            # Get the top procedure
            top_procedure = response_data['retrieved_procedures'][0]
            
            # Extract video ID for YouTube Player API
            if 'video_id' in top_procedure:
                video_id = top_procedure['video_id']
            
            # Extract YouTube embed URL
            if 'youtube_embed' in top_procedure:
                video_url = top_procedure['youtube_embed']
            elif 'youtube_url' in top_procedure:
                video_url = top_procedure['youtube_url']
            
            # Extract answer segment times (in seconds)
            if 'answer_start' in top_procedure:
                answer_start = int(top_procedure['answer_start'])
            if 'answer_end' in top_procedure:
                answer_end = int(top_procedure['answer_end'])
            
            # Extract steps with timestamps
            if 'steps' in top_procedure and top_procedure['steps']:
                video_steps = [
                    {
                        'time': step.get('absolute_bounds', [0])[0],
                        'description': step.get('heading', 'Step')
                    }
                    for step in top_procedure['steps']
                ]
        
        return jsonify({
            'query': response_data['query'],
            'response': response_data['response'],
            'video_url': video_url,
            'video_id': video_id,
            'answer_start': answer_start,
            'answer_end': answer_end,
            'video_steps': video_steps,
            'retrieved_procedures': response_data['retrieved_procedures']
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'database_loaded': len(db.procedures) > 0,
        'num_procedures': len(db.procedures),
        'ai_provider': config['ai']['provider']
    })

if __name__ == '__main__':
    host = config['web']['host']
    port = config['web']['port']
    debug = config['web']['debug']
    
    print(f"\nStarting web server...")
    print(f"   Access at: http://localhost:{port}")
    print(f"   Press Ctrl+C to stop")
    print("=" * 60)
    
    app.run(host=host, port=port, debug=debug)

