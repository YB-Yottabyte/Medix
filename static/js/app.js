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

async function submitQuery() {
    const query = document.getElementById('queryInput').value.trim();
    if (!query) {
        alert('Please enter a question!');
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
        const response = await fetch('/api/query_video', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ query: query })
        });

        const data = await response.json();

        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }

        // Display response
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

        // Display video
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

        document.getElementById('responseSection').classList.add('active');
        document.getElementById('responseSection').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        document.getElementById('loading').classList.remove('active');
        document.getElementById('submitBtn').disabled = false;
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

