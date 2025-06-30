document.addEventListener('DOMContentLoaded', () => {
  const getElement = (id) => {
    const el = document.getElementById(id);
    if (!el) console.error(`Element with ID '${id}' not found`);
    return el;
  };
  
  const textInput = getElement('textInput');
  const useTextBtn = getElement('useTextBtn');
  const generateTextBtn = getElement('generateTextBtn');
  const topicSelect = getElement('topicSelect');
  const difficultySelect = getElement('difficultySelect');
  const randomTextBtn = getElement('randomTextBtn');
  const voiceSelect = getElement('voiceSelect');
  const generateBtn = getElement('generateBtn');
  const audioPlayer = getElement('audioPlayer');
  const textDisplay = getElement('textDisplay');
  // const pauseDuration = getElement('pauseDuration');
  const repeatBtn = getElement('repeatBtn');
  const speedControl = getElement('speedControl');
  const speedValue = getElement('speedValue');
  const recordBtn = getElement('recordBtn');
  const recordingPlayer = getElement('recordingPlayer');
  const recordingControls = getElement('recordingControls');
  const recordingStatus = getElement('recordingStatus');
  const analyzeBtn = getElement('analyzeBtn');
  const analysisModal = getElement('analysisModal');
  const closeModal = document.querySelector('.close-modal');
  const scoreValue = getElement('scoreValue');
  const feedbackText = getElement('feedbackText');
  const wordScores = getElement('wordScores');

  if (!textInput || !generateBtn || !audioPlayer) {
    console.error('Critical elements missing - cannot initialize app');
    return;
  }

  const API_ENDPOINT = 'https://681ap8gn9i.execute-api.us-east-1.amazonaws.com/';

  let mediaRecorder;
  let audioChunks = [];
  let currentRecording = null;

  // Toggle between manual text input and text generation
  if (useTextBtn && generateTextBtn) {
    useTextBtn.addEventListener('click', () => {
      useTextBtn.classList.add('active');
      generateTextBtn.classList.remove('active');
      textInput.style.display = 'block';
      textGenerationControls.style.display = 'none';
    });

    generateTextBtn.addEventListener('click', () => {
      generateTextBtn.classList.add('active');
      useTextBtn.classList.remove('active');
      textInput.style.display = 'block';
      textGenerationControls.style.display = 'block';
    });
  }

  // Text generation via Bedrock API
  if (randomTextBtn) {
    randomTextBtn.addEventListener('click', async () => {
      try {
        randomTextBtn.disabled = true;
        randomTextBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

        const topic = topicSelect.value;
        const difficulty = difficultySelect.value;

        const response = await fetch(`${API_ENDPOINT}/generate-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, difficulty })
        });

        if (!response.ok) throw new Error('Failed to generate text');

        const { text } = await response.json();
        if (!text) throw new Error('No text returned from API');

        textInput.value = text;
      } catch (error) {
        console.error('Text generation error:', error);
        alert('Failed to generate text: ' + error.message);
      } finally {
        randomTextBtn.disabled = false;
        randomTextBtn.innerHTML = 'Generate Random Text';
      }
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      try {
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

        const text = textInput.value.trim();
        const voiceId = voiceSelect.value;
        // const pauseSec = parseFloat(pauseDuration.value);

        if (!text) {
          alert('Please enter or generate text.');
          return;
        }

        const ssml = addPausesToText(text);
        console.log('Generated SSML:', ssml); // Debug SSML
        const response = await fetch(`${API_ENDPOINT}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: ssml, voiceId })
        });

        if (!response.ok) throw new Error('Failed to generate speech');

        const { audio, speechMarks } = await response.json();
        console.log('Speech Marks:', speechMarks); // Debug speech marks
        const audioBlob = new Blob([Uint8Array.from(atob(audio), c => c.charCodeAt(0))], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayer.src = audioUrl;

        setupKaraokeWithSpeechMarks(text, speechMarks);
        syncHighlightWithSpeechMarks(audioPlayer, speechMarks);

        // Ensure audio is preloaded before playing
        audioPlayer.addEventListener('canplaythrough', () => {
          audioPlayer.play().catch(err => console.error('Playback failed:', err));
        }, { once: true });

      } catch (error) {
        alert('Error generating speech');
        console.error(error);
      } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = 'Generate Speech';
      }
    });
  }

  if (speedControl && speedValue && audioPlayer) {
    speedControl.addEventListener('input', () => {
      audioPlayer.playbackRate = speedControl.value;
      speedValue.textContent = `${speedControl.value}x`;
    });
  }

  if (repeatBtn && audioPlayer) {
    repeatBtn.addEventListener('click', () => {
      if (audioPlayer.src) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 3);
        audioPlayer.play();
      }
    });
  }

  function setupKaraokeWithSpeechMarks(text, speechMarks) {
    const displayWords = text.replace(/<[^>]+>/g, '').split(/\s+/);
    textDisplay.innerHTML = displayWords.map((word, i) =>
      `<span class="word" data-index="${i}">${word}</span>`
    ).join(' ');
    window._speechMarks = speechMarks.filter(m => m.type === 'word' || m.type === 'ssml');
  }

  function syncHighlightWithSpeechMarks(audio, speechMarks) {
    const wordElements = document.querySelectorAll('.word');
    const marks = speechMarks.filter(m => m.type === 'word' || m.type === 'ssml');
    let lastIdx = -1;
    let playbackOffset = 0;

    // Estimate playback offset
    audio.addEventListener('play', () => {
      const startTime = performance.now();
      audio.addEventListener('playing', () => {
        playbackOffset = performance.now() - startTime;
        console.log('Playback offset:', playbackOffset);
        highlightWord(0);
      }, { once: true });
    });

    function highlightWord(idx) {
      if (idx >= marks.length || audio.paused) return;
      wordElements.forEach(w => w.classList.remove('highlight', 'pause-active'));

      if (marks[idx].type === 'word' && wordElements[idx]) {
        wordElements[idx].classList.add('highlight');
        console.log(`Highlighting word ${idx} at audio time ${audio.currentTime}s, mark time ${marks[idx].time / 1000}s`);
      } else if (marks[idx].type === 'ssml' && wordElements[lastIdx]) {
        wordElements[lastIdx].classList.add('pause-active');
      }

      lastIdx = idx;

      const nextIdx = idx + 1;
      if (nextIdx < marks.length) {
        const currentTimeMs = audio.currentTime * 1000;
        const nextTime = (marks[nextIdx].time / audio.playbackRate) - playbackOffset;
        const delay = nextTime - (currentTimeMs / audio.playbackRate);
        if (delay > 0) {
          setTimeout(() => highlightWord(nextIdx), delay);
        } else {
          highlightWord(nextIdx); // Immediate transition if delay is negative
        }
      }
    }

    audio.addEventListener('seeked', () => {
      lastIdx = -1;
      wordElements.forEach(w => w.classList.remove('highlight', 'pause-active'));
      const currentTimeMs = (audio.currentTime * 1000) / audio.playbackRate;
      const idx = marks.findIndex(m => currentTimeMs >= (m.time / audio.playbackRate) - playbackOffset);
      if (idx >= 0) {
        highlightWord(idx);
      }
    });
  }

  async function toggleRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          currentRecording = new Blob(audioChunks, { type: 'audio/webm' });
          recordingPlayer.src = URL.createObjectURL(currentRecording);
          recordingControls.style.display = 'block';
          recordingStatus.style.display = 'none';
        };

        mediaRecorder.start();
        recordBtn.innerHTML = '<i class="fas fa-stop"></i> Stop Practice';
        recordingStatus.style.display = 'flex';
        recordBtn.classList.add('active');
      } catch (error) {
        console.error('Recording failed:', error);
        alert('Microphone access denied. Please enable microphone permissions.');
      }
    } else {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      recordBtn.innerHTML = '<i class="fas fa-microphone"></i> Start Practice';
      recordBtn.classList.remove('active');
    }
  }

  recordBtn.addEventListener('click', toggleRecording);

  analyzeBtn.addEventListener('click', analyzeRecording);

  async function analyzeRecording() {
    if (!currentRecording) {
      alert('Please record something first');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', new Blob([currentRecording], { type: 'audio/webm' }), 'recording.webm');
      
      const response = await fetch(`${API_ENDPOINT}/analyze`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Analysis failed');
      const results = await response.json();
      showAnalysisResults(results);
    } catch (error) {
      console.error('Analysis error:', error);
      alert('Analysis failed: ' + error.message);
    }
  }

  function showAnalysisResults(results) {
    if (!results.data) {
      console.error('Invalid analysis results:', results);
      alert('Analysis failed: invalid response format');
      return;
    }

    animateValue('scoreValue', 0, results.data.score, 1000);
    // feedbackText.textContent = results.data.feedback.replace(/^\d+\s*/, '');

    // Group words by score ranges
    const wordScoresData = results.data.wordScores?.filter(word => !['.', ','].includes(word.word)) || [];
    const excellent = wordScoresData.filter(word => word.score >= 90);
    const good = wordScoresData.filter(word => word.score >= 70 && word.score < 90);
    const needsImprovement = wordScoresData.filter(word => word.score < 70);

    wordScores.innerHTML = `
      <div class="score-section">
        <div class="score-circle" data-score="${results.data.score}">
          <span>${results.data.score}</span>
        </div>
        <h3>Pronunciation Analysis</h3>
        <p class="feedback">${results.data.feedback.replace(/^\d+\s*/, '')}</p>
      </div>
      <div class="word-scores-container">
        ${excellent.length ? `
          <h4>Excellent (90-100%)</h4>
          <div class="word-grid">
            ${excellent.map(word => `
              <div class="word-score excellent" role="listitem">
                <span class="word">${word.word}</span>
                <span class="score">${word.score}%</span>
                ${word.feedback && word.feedback !== 'Good pronunciation' ? `<div class="word-feedback">${word.feedback.replace(/^\d+\s*/, '')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${good.length ? `
          <h4>Good (70-89%)</h4>
          <div class="word-grid">
            ${good.map(word => `
              <div class="word-score good" role="listitem">
                <span class="word">${word.word}</span>
                <span class="score">${word.score}%</span>
                ${word.feedback && word.feedback !== 'Good pronunciation' ? `<div class="word-feedback">${word.feedback.replace(/^\d+\s*/, '')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${needsImprovement.length ? `
          <h4>Needs Improvement (<70%)</h4>
          <div class="word-grid">
            ${needsImprovement.map(word => `
              <div class="word-score needs-improvement" role="listitem">
                <span class="word">${word.word}</span>
                <span class="score">${word.score}%</span>
                ${word.feedback ? `<div class="word-feedback">${word.feedback.replace(/^\d+\s*/, '')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${wordScoresData.length === 0 ? '<p>No word-level scores available.</p>' : ''}
      </div>
    `;

    analysisModal.style.display = 'block';
  }

  closeModal.addEventListener('click', () => {
    analysisModal.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === analysisModal) {
      analysisModal.style.display = 'none';
    }
  });

  function animateValue(id, start, end, duration) {
    const element = document.getElementById(id);
    if (!element) return;

    let startTime = null;

    function updateValue(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const value = Math.floor(progress * (end - start) + start);
      element.textContent = value;

      if (progress < 1) {
        window.requestAnimationFrame(updateValue);
      }
    }

    window.requestAnimationFrame(updateValue);
  }

  function getScoreClass(score) {
    if (score >= 80) return 'good';
    if (score >= 50) return 'medium';
    return 'poor';
  }

  function addPausesToText(text) {
    const phrases = text.split(/(?<=[.!?,])\s+/);
    return phrases.map(phrase => {
      const pauseMs = 1000;
      if (phrase.trim().endsWith(',')) {
        return `${phrase}<break time="${pauseMs/2}ms"/>`;
      } else if (phrase.trim().endsWith('.') || 
                 phrase.trim().endsWith('!') || 
                 phrase.trim().endsWith('?')) {
        return `${phrase}<break time="${pauseMs}ms"/>`;
      }
      return phrase;
    }).join(' ');
  }

  if (!window.config) {
    console.warn('Frontend config not found. Using default API endpoint');
  }
});