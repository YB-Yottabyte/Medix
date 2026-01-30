#!/usr/bin/env python3
"""
Vercel API endpoint for medical QA system - lightweight version
"""
from flask import Flask, request, jsonify, render_template_string

app = Flask(__name__)

# Simplified medical Q&A data (no heavy dependencies)
QA_DATA = [
    {"q": "cpr", "a": "1. Check responsiveness 2. Call 911 3. Push hard and fast on chest center 4. 30 compressions, 2 breaths 5. Repeat until help arrives"},
    {"q": "burn", "a": "1. Cool burn with water for 10-20 minutes 2. Remove jewelry near burn 3. Cover with sterile bandage 4. Seek medical care for severe burns"},
    {"q": "bleeding", "a": "1. Apply direct pressure with clean cloth 2. Elevate injured area above heart 3. Maintain pressure until bleeding stops 4. Get emergency help if severe"},
    {"q": "choking", "a": "1. Encourage coughing 2. Give 5 back blows between shoulder blades 3. Give 5 abdominal thrusts 4. Alternate until object dislodged or help arrives"},
    {"q": "sprain", "a": "1. Rest the injured area 2. Ice for 15-20 minutes every 2-3 hours 3. Compress with elastic bandage 4. Elevate above heart level"},
]

HTML = '''<!DOCTYPE html><html><head><title>Medical QA</title><style>body{font-family:Arial;margin:20px}.container{max-width:600px;margin:0 auto}input{width:100%;padding:10px;margin:10px 0}button{padding:10px 20px;background:#007bff;color:white;border:none;border-radius:5px}.result{margin:20px 0;padding:15px;background:#f9f9f9;border-radius:5px}</style></head><body><div class="container"><h1>Medical QA System</h1><input type="text" id="q" placeholder="Ask: CPR, burns, bleeding, choking, sprains..."><button onclick="ask()">Ask</button><div id="result"></div></div><script>function ask(){const q=document.getElementById('q').value.toLowerCase();fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})}).then(r=>r.json()).then(d=>document.getElementById('result').innerHTML='<div class="result"><strong>Answer:</strong> '+d.answer+'</div>')}</script></body></html>'''

@app.route('/')
def home():
    return HTML

@app.route('/api/query', methods=['POST'])
def query():
    try:
        q = request.get_json().get('query', '').lower()
        for item in QA_DATA:
            if item['q'] in q:
                return jsonify({'answer': item['a']})
        return jsonify({'answer': 'Please ask about: CPR, burns, bleeding, choking, or sprains. For serious medical issues, call 911.'})
    except:
        return jsonify({'error': 'Please try again'}), 500