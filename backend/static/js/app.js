let player = null;
let videoEndTime = 0;
let videoStartTime = 0;
let checkInterval = null;
let currentVideoId = '';
let isPlayingAudio = false;
let currentUtterance = null;

function toggleAudioPlayback() {
    const iconBtn = document.getElementById('audioIconBtn');
    const responseText = document.getElementById('responseContent').textContent;

    if (isPlayingAudio) {
        // Stop playing
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        isPlayingAudio = false;
        iconBtn.classList.remove('playing');
        currentUtterance = null;
    } else {
        // Start playing with enhanced browser TTS
        if (!('speechSynthesis' in window)) {
            alert('Audio is not supported in your browser.');
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        currentUtterance = new SpeechSynthesisUtterance(responseText);

        currentUtterance.rate = 0.88;
        currentUtterance.pitch = 0.95;
        currentUtterance.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(voice =>
            voice.lang.startsWith('en') &&
            (voice.name.includes('Google US English') ||
             voice.name.includes('Google UK English Female') ||
             voice.name.includes('Microsoft Zira') ||
             voice.name.includes('Microsoft David') ||
             voice.name.includes('Microsoft Mark'))
        ) || voices.find(voice =>
            voice.lang.startsWith('en') && voice.name.includes('Google')
        ) || voices.find(voice =>
            voice.lang.startsWith('en') && voice.name.includes('Microsoft')
        ) || voices.find(voice => voice.lang.startsWith('en'));

        if (preferredVoice) {
            currentUtterance.voice = preferredVoice;
            console.log('Using voice:', preferredVoice.name);
        }

        currentUtterance.onstart = function() {
            isPlayingAudio = true;
            iconBtn.classList.add('playing');
        };

        currentUtterance.onend = function() {
            isPlayingAudio = false;
            iconBtn.classList.remove('playing');
            currentUtterance = null;
        };

        currentUtterance.onerror = function() {
            isPlayingAudio = false;
            iconBtn.classList.remove('playing');
            currentUtterance = null;
        };

        window.speechSynthesis.speak(currentUtterance);
    }
}

// Load voices when available
if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = function() {
        window.speechSynthesis.getVoices();
    };
}

function onYouTubeIframeAPIReady() {
    console.log('YouTube API Ready');
}

function createPlayer(videoId, startSeconds, endSeconds) {
    currentVideoId = videoId;
    videoStartTime = startSeconds || 0;
    videoEndTime = endSeconds || 9999;

    if (player) {
        player.destroy();
        player = null;
    }
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }

    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            autoplay: 1,
            start: Math.floor(startSeconds),
            end: Math.floor(endSeconds),
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1
        },
        events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    console.log('Playing from', videoStartTime, 'to', videoEndTime);
    event.target.playVideo();

    checkInterval = setInterval(() => {
        if (player && typeof player.getCurrentTime === 'function') {
            const currentTime = player.getCurrentTime();
            if (currentTime >= videoEndTime) {
                player.pauseVideo();
                clearInterval(checkInterval);
                showSegmentComplete();
            }
        }
    }, 500);
}

function onPlayerStateChange(event) {
    if (event.data === 0 && checkInterval) {
        clearInterval(checkInterval);
    }
}

function showSegmentComplete() {
    const info = document.getElementById('segmentInfo');
    if (info) {
        info.innerHTML = `
            <strong>✅ Segment Complete!</strong>
            <br>Watched: ${formatTime(videoStartTime)} - ${formatTime(videoEndTime)}
            <br><button class="replay-btn" onclick="replaySegment()">🔄 Replay Segment</button>
        `;
    }
}

function replaySegment() {
    if (player && currentVideoId) {
        player.seekTo(videoStartTime);
        player.playVideo();

        if (checkInterval) clearInterval(checkInterval);
        checkInterval = setInterval(() => {
            if (player && typeof player.getCurrentTime === 'function') {
                if (player.getCurrentTime() >= videoEndTime) {
                    player.pauseVideo();
                    clearInterval(checkInterval);
                    showSegmentComplete();
                }
            }
        }, 500);
    }
}

function setQuery(text) {
    document.getElementById('queryInput').value = text;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + secs.toString().padStart(2, '0');
}

function jumpToTime(seconds) {
    if (player) {
        player.seekTo(seconds);
        player.playVideo();
    }
}

let selectedImageFile = null;

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file (PNG, JPG, JPEG)');
        return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('Image file is too large. Maximum size is 10MB.');
        return;
    }

    selectedImageFile = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('previewImg').src = e.target.result;
        document.getElementById('imagePreview').style.display = 'block';
        document.getElementById('imageUploadArea').style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function clearImage() {
    selectedImageFile = null;
    document.getElementById('imageInput').value = '';
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('imageUploadArea').style.display = 'block';
}

async function submitQuery() {
    const query = document.getElementById('queryInput').value.trim();
    const hasImage = selectedImageFile !== null;

    // Check if user provided either query or image
    if (!query && !hasImage) {
        alert('Please enter a question or upload an image!');
        return;
    }

    document.getElementById('loading').classList.add('active');
    document.getElementById('responseSection').classList.remove('active');
    document.getElementById('submitBtn').disabled = true;

    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }

    try {
        let data;

        // If image is provided, use multimodal endpoint so text + image are fused
        if (hasImage) {
            const formData = new FormData();
            formData.append('image', selectedImageFile);
            if (query) {
                formData.append('query', query);
            }

            const response = await fetch('/api/multimodal_query', {
                method: 'POST',
                body: formData
            });

            data = await response.json();

            if (data.error) {
                alert('Error: ' + data.error);
                return;
            }

            // Display fused multimodal results (question + image)
            displayMultimodalResults(data);
        } else {
            // Use regular text query
            const response = await fetch('/api/query_video', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ query: query })
            });

            data = await response.json();

            if (data.error) {
                alert('Error: ' + data.error);
                return;
            }

            // Display regular query results
            displayTextQueryResults(data);
        }

        document.getElementById('responseSection').classList.add('active');
        document.getElementById('responseSection').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loading').classList.remove('active');
        document.getElementById('submitBtn').disabled = false;
    }
}

function displayMultimodalResults(data) {
    const responseContent = document.getElementById('responseContent');
    if (responseContent) {
        let resultText = '';

        if (data.is_emergency && data.emergency_warning) {
            resultText += data.emergency_warning + '\n\n';
        }

        // Backend prompt generates the full conversational structure.
        resultText += data.response || 'No response available';

        responseContent.textContent = resultText;
        document.getElementById('audioIconBtn').style.display = 'flex';
    }

    displayVideoPlayer(data);
}

function displayImageRecognitionResults(data) {
    const responseContent = document.getElementById('responseContent');
    if (responseContent) {
        let resultText = '';

        // Display emergency warning prominently if detected
        if (data.is_emergency && data.emergency_warning) {
            resultText += '🚨 ' + data.emergency_warning + '\n\n';
            resultText += '═'.repeat(60) + '\n\n';
        }

        resultText += '🧠 AI VISION ANALYSIS (Llama 4 Scout)\n\n';

        // Show what the VLM detected in the image
        if (data.recognition) {
            const r = data.recognition;
            if (r.detected_body_part) {
                resultText += `📍 Body Part: ${r.detected_body_part}\n`;
            }
            if (r.detected_condition) {
                resultText += `🩹 Condition: ${r.detected_condition}\n`;
            }
            if (r.detected_severity) {
                resultText += `⚠️  Severity: ${r.detected_severity}\n`;
            }
            if (r.description) {
                resultText += `📝 Description: ${r.description}\n`;
            }
            resultText += '\n';
        }

        resultText += '📋 MATCHED PROCEDURE\n';
        resultText += `✅ ${data.question}\n`;
        resultText += `🎯 Confidence: ${data.confidence.toFixed(1)}%\n\n`;

        if (data.ai_guidance) {
            resultText += '💡 AI GUIDANCE:\n';
            resultText += data.ai_guidance;
        }

        if (data.recognition && data.recognition.all_matches && data.recognition.all_matches.length > 1) {
            resultText += '\n\n📌 Other Possible Matches:\n';
            data.recognition.all_matches.slice(1).forEach((match, idx) => {
                resultText += `${idx + 2}. ${match.question} (${match.confidence.toFixed(1)}%)\n`;
            });
        }

        responseContent.textContent = resultText;
        document.getElementById('audioIconBtn').style.display = 'flex';
    }

    displayVideoPlayer(data);
}

function displayTextQueryResults(data) {
    const responseContent = document.getElementById('responseContent');
    if (responseContent) {
            // Format text with proper indentation for numbered lists
            let formattedText = data.response || 'No response available';

            // Add indentation to lines starting with numbers
            formattedText = formattedText.split('\n').map(line => {
                // Check if line starts with a number followed by a period or parenthesis
                if (/^\d+[\.\)]/.test(line.trim())) {
                    return '  ' + line; // Add 2 spaces indent
                }
                return line;
            }).join('\n');

            responseContent.textContent = formattedText;
            document.getElementById('audioIconBtn').style.display = 'flex';
        }

    displayVideoPlayer(data);
}

function displayVideoPlayer(data) {
        const videoSection = document.getElementById('videoSection');
        const segmentInfo = document.getElementById('segmentInfo');
        const segmentTime = document.getElementById('segmentTime');
        const videoSteps = document.getElementById('videoSteps');

        if (data.video_id && data.answer_start !== undefined && data.answer_end !== undefined) {
            if (videoSection) videoSection.style.display = 'block';

            if (segmentTime) {
                segmentTime.textContent = formatTime(data.answer_start) + ' - ' + formatTime(data.answer_end);
            }
            if (segmentInfo) {
                segmentInfo.innerHTML =
                    '<strong>🎯 Playing segment:</strong> ' + formatTime(data.answer_start) + ' - ' + formatTime(data.answer_end) +
                    '<br><small>Video will automatically stop at the end of the relevant segment</small>' +
                    '<br><button class="replay-btn" onclick="replaySegment()">🔄 Replay Segment</button>';
            }

            createPlayer(data.video_id, data.answer_start, data.answer_end);

            if (videoSteps) {
                videoSteps.innerHTML =
                    '<div class="video-step" onclick="jumpToTime(' + data.answer_start + ')">' +
                    '<span class="step-time">' + formatTime(data.answer_start) + '</span>' +
                    '<span>▶️ Start of answer</span></div>' +
                    '<div class="video-step" onclick="jumpToTime(' + data.answer_end + ')">' +
                    '<span class="step-time">' + formatTime(data.answer_end) + '</span>' +
                    '<span>⏹️ End of answer</span></div>';
            }
        } else {
            if (videoSection) videoSection.style.display = 'none';
        }
}

document.getElementById('queryInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuery();
    }
});

// Scroll to top button
window.addEventListener('scroll', function() {
    const scrollBtn = document.getElementById('scrollTop');
    if (window.pageYOffset > 300) {
        scrollBtn.classList.add('show');
    } else {
        scrollBtn.classList.remove('show');
    }
});

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}


// ================================================================
// VOICE INPUT — Web Speech API (browser) with Whisper fallback
// ================================================================

let isRecording = false;
let recognition = null;
let mediaRecorder = null;
let audioChunks = [];

function toggleVoiceInput() {
    if (isRecording) {
        stopVoiceInput();
    } else {
        startVoiceInput();
    }
}

function startVoiceInput() {
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceStatusText = document.getElementById('voiceStatusText');

    // Try browser Web Speech API first (Chrome, Edge)
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = function() {
            isRecording = true;
            voiceBtn.classList.add('recording');
            voiceStatus.style.display = 'flex';
            voiceStatusText.textContent = 'Listening...';
        };

        recognition.onresult = function(event) {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            document.getElementById('queryInput').value = transcript;

            if (event.results[event.results.length - 1].isFinal) {
                voiceStatusText.textContent = 'Got it!';
                setTimeout(() => stopVoiceInput(), 500);
            } else {
                voiceStatusText.textContent = 'Listening: "' + transcript.substring(0, 40) + '..."';
            }
        };

        recognition.onerror = function(event) {
            console.log('Speech recognition error:', event.error);
            if (event.error === 'not-allowed') {
                voiceStatusText.textContent = 'Microphone access denied';
            } else {
                // Fallback to server-side Whisper
                voiceStatusText.textContent = 'Switching to Whisper...';
                stopVoiceInput();
                startWhisperRecording();
                return;
            }
            setTimeout(() => stopVoiceInput(), 2000);
        };

        recognition.onend = function() {
            if (isRecording) {
                stopVoiceInput();
            }
        };

        recognition.start();
    } else {
        // No browser speech API — use server-side Whisper
        startWhisperRecording();
    }
}

function stopVoiceInput() {
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceStatus = document.getElementById('voiceStatus');

    isRecording = false;
    voiceBtn.classList.remove('recording');

    if (recognition) {
        recognition.stop();
        recognition = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    setTimeout(() => {
        voiceStatus.style.display = 'none';
    }, 1500);
}

async function startWhisperRecording() {
    const voiceBtn = document.getElementById('voiceBtn');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceStatusText = document.getElementById('voiceStatusText');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = function(event) {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async function() {
            stream.getTracks().forEach(track => track.stop());

            if (audioChunks.length === 0) return;

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            voiceStatusText.textContent = 'Transcribing with Whisper...';

            try {
                const formData = new FormData();
                formData.append('audio', audioBlob, 'recording.webm');

                const response = await fetch('/api/voice_transcribe', {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (data.success && data.text) {
                    document.getElementById('queryInput').value = data.text;
                    voiceStatusText.textContent = 'Got it!';
                } else {
                    voiceStatusText.textContent = 'Could not transcribe';
                }
            } catch (error) {
                console.error('Whisper transcription error:', error);
                voiceStatusText.textContent = 'Transcription failed';
            }

            setTimeout(() => {
                voiceStatus.style.display = 'none';
            }, 1500);
        };

        isRecording = true;
        voiceBtn.classList.add('recording');
        voiceStatus.style.display = 'flex';
        voiceStatusText.textContent = 'Recording... tap mic to stop';
        mediaRecorder.start();

    } catch (err) {
        console.error('Microphone access error:', err);
        voiceStatus.style.display = 'flex';
        voiceStatusText.textContent = 'Microphone access denied';
        setTimeout(() => { voiceStatus.style.display = 'none'; }, 2000);
    }
}
