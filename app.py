"""
Flask Web Application for Medical Procedure Q&A
Multimodal pipeline: text + image + voice + video-frame analysis
"""
from flask import Flask, render_template, request, jsonify
import yaml
import base64
import time
from pathlib import Path
from database.medical_db import MedicalDatabase
from database.retriever import ProcedureRetriever
from models.llm import AIHandler
from models.generator import ResponseGenerator
from models.image_recognizer import MedicalImageRecognizer

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max file size

# Load configuration
with open('config.yaml', 'r') as f:
    config = yaml.safe_load(f)

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

# Initialize image recognizer for visual queries
print("\nInitializing Image Recognition System...")
image_recognizer = MedicalImageRecognizer(config, db)

print("\nSystem ready!")
print(f"   - Database: {len(db.procedures)} procedures loaded")
print(f"   - AI Provider: {config['ai']['provider']}")
print(f"   - Image Recognition: Enabled (Llama 4 Scout VLM)")
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

@app.route('/api/image_query', methods=['POST'])
def image_query():
    """Handle image-based medical condition recognition"""
    try:
        # Check if image file is present
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        image_file = request.files['image']
        
        if image_file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        # Read image bytes
        image_bytes = image_file.read()
        
        if len(image_bytes) == 0:
            return jsonify({'error': 'Empty image file'}), 400
        
        # Check file size
        max_size = config.get('vision', {}).get('max_image_size', 10485760)
        if len(image_bytes) > max_size:
            return jsonify({'error': f'Image file too large. Max size: {max_size/1024/1024}MB'}), 400
        
        # Perform image recognition
        recognition_result = image_recognizer.recognize_from_bytes(image_bytes)
        
        if not recognition_result['success']:
            return jsonify({'error': 'Image recognition failed'}), 500
        
        top_match = recognition_result['top_match']
        
        if not top_match:
            return jsonify({'error': 'No matching procedures found'}), 404
        
        # Extract video information
        video_id = top_match.get('video_id')
        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else None
        
        # Get start and end times directly from the match
        answer_start = top_match.get('answer_start')
        answer_end = top_match.get('answer_end')
        
        # Get additional context using text query
        text_query = top_match.get('question', '')
        context_response = None
        
        if text_query:
            try:
                context_response = response_generator.generate(text_query)
            except Exception as e:
                print(f"Error generating context: {e}")
        
        # Add emergency warning if detected
        emergency_warning = None
        if recognition_result.get('is_emergency'):
            emergency_warning = (
                "⚠️ EMERGENCY DETECTED: This appears to be a life-threatening situation. "
                "If this is a real emergency, CALL 911 IMMEDIATELY. "
                "The guidance below is for educational purposes only and does not replace professional medical care."
            )
        
        return jsonify({
            'success': True,
            'recognition': {
                'top_match': top_match,
                'all_matches': recognition_result['all_matches'][:3],
                'method': recognition_result['recognition_method'],
                'detected_body_part': recognition_result.get('detected_body_part'),
                'detected_condition': recognition_result.get('detected_condition'),
                'detected_severity': recognition_result.get('detected_severity'),
                'description': recognition_result.get('description'),
                'search_query': recognition_result.get('search_query'),
            },
            'video_url': video_url,
            'video_id': video_id,
            'answer_start': answer_start,
            'answer_end': answer_end,
            'title': top_match.get('title'),
            'question': top_match.get('question'),
            'confidence': top_match.get('confidence'),
            'ai_guidance': context_response.get('response') if context_response else None,
            'is_emergency': recognition_result.get('is_emergency', False),
            'emergency_warning': emergency_warning
        })
        
    except Exception as e:
        print(f"Error in /api/image_query: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Internal error: {str(e)}'}), 500


# ================================================================
# NEW ENDPOINTS — Voice, Video-Frame, and Multimodal Pipeline
# ================================================================

@app.route('/api/voice_transcribe', methods=['POST'])
def voice_transcribe():
    """
    Transcribe audio using Groq Whisper API.
    Used when browser Web Speech API is unavailable (e.g., AR headset).
    Accepts audio file (webm/wav/mp3) → returns text transcription.
    """
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        audio_file = request.files['audio']
        audio_bytes = audio_file.read()

        if len(audio_bytes) == 0:
            return jsonify({'error': 'Empty audio file'}), 400

        from groq import Groq
        client = Groq(api_key=config['ai']['groq']['api_key'])

        # Use Groq's Whisper model for transcription
        import tempfile, os
        ext = audio_file.filename.rsplit('.', 1)[-1] if '.' in audio_file.filename else 'webm'
        with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            with open(tmp_path, 'rb') as f:
                transcription = client.audio.transcriptions.create(
                    model="whisper-large-v3",
                    file=f,
                    language="en",
                )
            text = transcription.text.strip()
        finally:
            os.unlink(tmp_path)

        print(f"  Voice transcription: {text}")

        return jsonify({
            'success': True,
            'text': text,
            'method': 'whisper-large-v3'
        })

    except Exception as e:
        print(f"Error in /api/voice_transcribe: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/frame_analyze', methods=['POST'])
def frame_analyze():
    """
    Analyze a single video frame (from camera/egocentric video).
    Designed for AR headset: send a frame, get real-time guidance.
    Accepts: base64-encoded image OR file upload.
    Returns: detected condition + matched procedure + guidance.
    """
    try:
        t0 = time.time()
        image_bytes = None

        # Accept either file upload or base64 JSON
        if 'frame' in request.files:
            image_bytes = request.files['frame'].read()
        elif request.is_json:
            data = request.get_json()
            b64 = data.get('frame_base64', '')
            if b64:
                # Strip data URI prefix if present
                if ',' in b64:
                    b64 = b64.split(',', 1)[1]
                image_bytes = base64.b64decode(b64)

        if not image_bytes or len(image_bytes) == 0:
            return jsonify({'error': 'No frame data provided'}), 400

        # Run VLM recognition
        recognition_result = image_recognizer.recognize_from_bytes(image_bytes)
        latency_ms = int((time.time() - t0) * 1000)

        if not recognition_result['success']:
            return jsonify({'error': 'Frame analysis failed'}), 500

        top = recognition_result['top_match']

        return jsonify({
            'success': True,
            'body_part': recognition_result.get('detected_body_part'),
            'condition': recognition_result.get('detected_condition'),
            'severity': recognition_result.get('detected_severity'),
            'description': recognition_result.get('description'),
            'matched_procedure': top['question'] if top else None,
            'video_id': top['video_id'] if top else None,
            'answer_start': top.get('answer_start') if top else None,
            'answer_end': top.get('answer_end') if top else None,
            'confidence': top.get('confidence') if top else 0,
            'is_emergency': recognition_result.get('is_emergency', False),
            'latency_ms': latency_ms,
        })

    except Exception as e:
        print(f"Error in /api/frame_analyze: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/multimodal_query', methods=['POST'])
def multimodal_query():
    """
    Combined multimodal endpoint: accepts text + image + voice together.
    This is the primary endpoint for the AR headset pipeline:
      - Voice audio → transcribed to text via Whisper
      - Camera frame → analyzed via VLM for visual context
      - Text query (from voice or typed) + visual context → RAG search → AI response
    """
    try:
        t0 = time.time()
        text_query = ''
        visual_context = None

        # --- Extract text query ---
        if request.content_type and 'multipart' in request.content_type:
            text_query = request.form.get('query', '').strip()

            # Transcribe voice if audio provided
            if 'audio' in request.files:
                audio_file = request.files['audio']
                audio_bytes = audio_file.read()
                if audio_bytes:
                    from groq import Groq
                    import tempfile, os
                    client = Groq(api_key=config['ai']['groq']['api_key'])
                    ext = audio_file.filename.rsplit('.', 1)[-1] if '.' in audio_file.filename else 'webm'
                    with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as tmp:
                        tmp.write(audio_bytes)
                        tmp_path = tmp.name
                    try:
                        with open(tmp_path, 'rb') as f:
                            transcription = client.audio.transcriptions.create(
                                model="whisper-large-v3", file=f, language="en"
                            )
                        voice_text = transcription.text.strip()
                        print(f"  Voice input: {voice_text}")
                        # Combine with any typed text
                        text_query = f"{text_query} {voice_text}".strip() if text_query else voice_text
                    finally:
                        os.unlink(tmp_path)

            # Analyze image/frame if provided
            if 'image' in request.files:
                img_bytes = request.files['image'].read()
                if img_bytes:
                    visual_context = image_recognizer.recognize_from_bytes(img_bytes)
        else:
            # JSON request
            data = request.get_json() or {}
            text_query = data.get('query', '').strip()

            if data.get('frame_base64'):
                b64 = data['frame_base64']
                if ',' in b64:
                    b64 = b64.split(',', 1)[1]
                img_bytes = base64.b64decode(b64)
                visual_context = image_recognizer.recognize_from_bytes(img_bytes)

        if not text_query and not visual_context:
            return jsonify({'error': 'No query, audio, or image provided'}), 400

        # --- Build enriched query from text + visual context ---
        enriched_query = text_query
        if visual_context and visual_context.get('success'):
            vc = visual_context
            visual_desc = (
                f"The image shows {vc.get('detected_condition', 'a condition')} "
                f"on the {vc.get('detected_body_part', 'body')}. "
                f"{vc.get('description', '')}"
            )
            if text_query:
                enriched_query = f"{text_query}. Visual context: {visual_desc}"
            else:
                enriched_query = vc.get('search_query', visual_desc)

        print(f"  Enriched query: {enriched_query[:100]}...")

        # --- RAG: multi-query search ---
        queries = [enriched_query]
        weights = [0.6]
        if text_query and text_query != enriched_query:
            queries.append(text_query)
            weights.append(0.2)
        if visual_context and visual_context.get('search_query'):
            queries.append(visual_context['search_query'])
            weights.append(0.2)

        retrieved = retriever.multi_query_search(queries, weights)

        # --- Generate AI response ---
        context = retriever.format_results_for_context(retrieved)
        ai_response = ai_handler.generate_response(enriched_query, context)

        # Extract video info from top result
        video_id = None
        answer_start = None
        answer_end = None
        if retrieved:
            top = retrieved[0]
            video_id = top.get('video_id')
            answer_start = top.get('answer_start')
            answer_end = top.get('answer_end')

        latency_ms = int((time.time() - t0) * 1000)

        # Emergency detection
        is_emergency = False
        emergency_warning = None
        if visual_context and visual_context.get('is_emergency'):
            is_emergency = True
        if is_emergency:
            emergency_warning = (
                "⚠️ EMERGENCY DETECTED: This appears to be a life-threatening situation. "
                "If this is a real emergency, CALL 911 IMMEDIATELY."
            )

        return jsonify({
            'success': True,
            'query': text_query,
            'enriched_query': enriched_query,
            'response': ai_response,
            'video_id': video_id,
            'video_url': f"https://www.youtube.com/watch?v={video_id}" if video_id else None,
            'answer_start': answer_start,
            'answer_end': answer_end,
            'retrieved_procedures': retrieved,
            'visual_analysis': {
                'body_part': visual_context.get('detected_body_part') if visual_context else None,
                'condition': visual_context.get('detected_condition') if visual_context else None,
                'severity': visual_context.get('detected_severity') if visual_context else None,
                'description': visual_context.get('description') if visual_context else None,
            } if visual_context else None,
            'is_emergency': is_emergency,
            'emergency_warning': emergency_warning,
            'latency_ms': latency_ms,
            'pipeline': 'multimodal-rag',
        })

    except Exception as e:
        print(f"Error in /api/multimodal_query: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/pipeline_info', methods=['GET'])
def pipeline_info():
    """Return system pipeline information for monitoring/thesis documentation."""
    return jsonify({
        'system': 'MedVidQA Multimodal RAG Pipeline',
        'version': '2.0',
        'pipeline_stages': {
            '1_input': {
                'text': 'Direct text query',
                'voice': 'Web Speech API (browser) or Whisper-large-v3 (server)',
                'image': 'Image upload or base64 frame',
                'video': 'Egocentric video frames via /api/frame_analyze',
            },
            '2_vision': {
                'model': 'Llama-4-Scout-17B (Groq)',
                'capability': 'Zero-shot medical image analysis',
                'output': 'Body part + condition + severity + search query',
            },
            '3_retrieval': {
                'method': 'Multi-query fusion RAG',
                'embedding_model': config['database']['embedding_model'],
                'database_size': len(db.procedures),
                'similarity_threshold': config['database']['similarity_threshold'],
            },
            '4_generation': {
                'model': config['ai']['groq']['model'],
                'provider': config['ai']['provider'],
                'context': 'Retrieved procedures + visual analysis',
            },
            '5_output': {
                'text': 'AI-generated step-by-step guidance',
                'video': 'YouTube video with timestamp segments',
                'audio': 'Text-to-speech (Web Speech API)',
            },
        },
        'ar_ready': True,
        'supported_endpoints': [
            '/api/query (text)',
            '/api/query_video (text + video)',
            '/api/image_query (image)',
            '/api/voice_transcribe (audio)',
            '/api/frame_analyze (camera frame)',
            '/api/multimodal_query (text + image + voice combined)',
            '/api/pipeline_info (system info)',
        ],
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
