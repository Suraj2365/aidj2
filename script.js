// --- AUDIO ENGINE SETUP ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

// --- STATE MANAGEMENT ---
let playlist = [];
let pendingTrack = null; // Track waiting to be loaded
let aiEnabled = false;

// --- DSP EFFECTS FACTORY ---
const Effects = {
    createEcho(ctx) {
        const delay = ctx.createDelay();
        delay.delayTime.value = 0.5; // 500ms delay
        const feedback = ctx.createGain();
        feedback.gain.value = 0.4;
        delay.connect(feedback);
        feedback.connect(delay);
        return { input: delay, output: delay, node: delay };
    },
    createReverb(ctx) {
        // Simple Reverb impulse simulation using Convolver
        const convolver = ctx.createConvolver();
        // Generate white noise impulse for reverb tail
        const rate = ctx.sampleRate;
        const length = rate * 2.0; // 2 seconds
        const impulse = ctx.createBuffer(2, length, rate);
        for (let i = 0; i < 2; i++) {
            const channel = impulse.getChannelData(i);
            for (let j = 0; j < length; j++) {
                channel[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2);
            }
        }
        convolver.buffer = impulse;
        return { input: convolver, output: convolver, node: convolver };
    }
};

// --- DECK CLASS ---
class Deck {
    constructor(id) {
        this.id = id;
        this.canvas = document.getElementById(`viz-${id.toLowerCase()}`);
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById(`deck-${id.toLowerCase()}`);
        
        // Audio Graph
        this.gainNode = audioCtx.createGain();
        this.analyser = audioCtx.createAnalyser();
        this.filter = audioCtx.createBiquadFilter();
        
        // Effects Bus (Dry/Wet)
        this.fxBus = audioCtx.createGain();
        this.fxBus.gain.value = 0; // Start Dry
        
        // Routing: Source -> Filter -> Gain -> Analyser -> Master
        this.filter.connect(this.gainNode);
        this.gainNode.connect(this.analyser);
        this.gainNode.connect(audioCtx.destination);
        
        this.source = null;
        this.buffer = null;
        this.isPlaying = false;
        this.fxActive = false;
    }

    load(buffer, metadata) {
        if(this.isPlaying) this.stop();
        this.buffer = buffer;
        this.metadata = metadata;
        document.getElementById(`title-${this.id.toLowerCase()}`).innerText = metadata.title;
    }

    play() {
        if(!this.buffer) return;
        if(audioCtx.state === 'suspended') audioCtx.resume();
        
        this.source = audioCtx.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.filter);
        
        // Handle Loop/End
        this.source.onended = () => {
            if(this.isPlaying) { // Natural end
                this.isPlaying = false;
                this.container.classList.remove('playing');
                if(aiEnabled) AiDirector.notifyEnd(this.id);
            }
        };

        this.source.start(0);
        this.isPlaying = true;
        this.container.classList.add('playing');
        this.visualize();
    }

    stop() {
        if(this.source) try { this.source.stop(); } catch(e){}
        this.isPlaying = false;
        this.container.classList.remove('playing');
    }

    togglePlay() {
        this.isPlaying ? this.stop() : this.play();
    }

    setVolume(val) {
        this.gainNode.gain.setTargetAtTime(parseFloat(val), audioCtx.currentTime, 0.1);
    }

    toggleFx(type) {
        this.fxActive = !this.fxActive;
        // Simple Simulation: Filter Sweep for all types for now to save CPU on client
        // In full version, route through specific effect nodes
        if(this.fxActive) {
            this.filter.type = "highpass";
            this.filter.frequency.setValueAtTime(100, audioCtx.currentTime);
            this.filter.frequency.exponentialRampToValueAtTime(3000, audioCtx.currentTime + 2);
        } else {
            this.filter.frequency.cancelScheduledValues(audioCtx.currentTime);
            this.filter.frequency.setValueAtTime(0, audioCtx.currentTime);
            this.filter.type = "allpass";
        }
    }

    visualize() {
        if(!this.isPlaying) return;
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const draw = () => {
            if(!this.isPlaying) return;
            requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);
            
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            
            const barWidth = (this.canvas.width / bufferLength) * 2.5;
            let x = 0;
            
            // Neon color based on Deck ID
            const colors = { 'A': '#ff0055', 'B': '#0088ff', 'C': '#ffaa00', 'D': '#00ff00' };
            this.ctx.fillStyle = colors[this.id];

            for(let i = 0; i < bufferLength; i++) {
                const barHeight = dataArray[i] / 2;
                this.ctx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };
        draw();
    }
}

// --- INITIALIZE DECKS ---
const decks = {
    A: new Deck('A'),
    B: new Deck('B'),
    C: new Deck('C'),
    D: new Deck('D')
};

// --- AI DIRECTOR (Simple Logic) ---
const AiDirector = {
    loop: null,
    
    start() {
        console.log("DJ SURI AI: Online");
        // Check decks every second
        this.loop = setInterval(() => this.scan(), 1000);
        
        // Auto-start if silence
        if(!Object.values(decks).some(d => d.isPlaying) && playlist.length > 0) {
            decks.A.load(playlist[0].buffer, playlist[0].meta);
            decks.A.play();
        }
    },

    stop() {
        clearInterval(this.loop);
        console.log("DJ SURI AI: Offline");
    },

    scan() {
        // Find playing deck
        const playingDeckKey = Object.keys(decks).find(k => decks[k].isPlaying);
        if(!playingDeckKey) return; // Silence or manual mode
        
        const deck = decks[playingDeckKey];
        // If track is near end (simulated randomly for demo 15s)
        // In real app, we check duration vs currentTime
        if(Math.random() < 0.05) { // 5% chance per second to trigger transition
            this.triggerTransition(playingDeckKey);
        }
    },

    triggerTransition(currentDeckId) {
        const nextDeckId = currentDeckId === 'A' ? 'B' : (currentDeckId === 'B' ? 'C' : (currentDeckId === 'C' ? 'D' : 'A'));
        const nextDeck = decks[nextDeckId];
        
        // Pick random track
        const track = playlist[Math.floor(Math.random() * playlist.length)];
        if(!track) return;

        console.log(`AI: Mixing ${currentDeckId} -> ${nextDeckId}`);
        
        // 1. Load Next
        nextDeck.load(track.buffer, track.meta);
        
        // 2. Start Next Silent
        nextDeck.gainNode.gain.value = 0;
        nextDeck.play();
        
        // 3. Crossfade & FX
        const now = audioCtx.currentTime;
        // Fade In Next
        nextDeck.gainNode.gain.linearRampToValueAtTime(1.0, now + 5);
        // Fade Out Current
        decks[currentDeckId].gainNode.gain.linearRampToValueAtTime(0, now + 5);
        
        // Apply Filter Sweep to Outgoing
        decks[currentDeckId].toggleFx('filter');
        setTimeout(() => decks[currentDeckId].stop(), 5000);
    },
    
    notifyEnd(deckId) {
        // Fallback if song ends abruptly
        this.scan();
    }
};

// --- UI LOGIC ---
const modal = document.getElementById('deck-selector-modal');

// Load Button Clicked
function promptLoadDeck(trackIndex) {
    pendingTrack = playlist[trackIndex];
    modal.classList.remove('hidden');
}

function closeModal() {
    modal.classList.add('hidden');
    pendingTrack = null;
}

function loadToDeck(deckId) {
    if(!pendingTrack) return;
    decks[deckId].load(pendingTrack.buffer, pendingTrack.meta);
    closeModal();
}

// File Upload
document.getElementById('file-upload').addEventListener('change', async (e) => {
    for(const file of e.target.files) {
        const buffer = await file.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(buffer);
        addTrackToPlaylist(file.name, audioBuffer);
    }
});

function addTrackToPlaylist(name, buffer) {
    const track = {
        meta: { title: name },
        buffer: buffer
    };
    playlist.push(track);
    
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span> <button style="background:#333; color:white; border:none; cursor:pointer;" onclick="promptLoadDeck(${playlist.length-1})">LOAD</button>`;
    document.getElementById('playlist').appendChild(li);
}

// Online Demo Loader
async function loadOnlineDemo() {
    // Using a reliable short sample from a CDN
    const url = "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3";
    try {
        const btn = document.querySelector('.demo-btn');
        btn.innerText = "Downloading...";
        const resp = await fetch(url);
        const buff = await resp.arrayBuffer();
        const audioBuff = await audioCtx.decodeAudioData(buff);
        addTrackToPlaylist("Demo: Cyberpunk Beat (Online)", audioBuff);
        btn.innerText = "🌐 Load Online Demo";
    } catch(err) {
        alert("Could not load online demo. Check connection.");
    }
}

// AI Toggle
document.getElementById('toggle-ai-btn').addEventListener('click', (e) => {
    aiEnabled = !aiEnabled;
    const btn = document.getElementById('toggle-ai-btn');
    if(aiEnabled) {
        btn.classList.add('active');
        btn.innerHTML = `<span class="icon">🤖</span> AI ACTIVE`;
        AiDirector.start();
    } else {
        btn.classList.remove('active');
        btn.innerHTML = `<span class="icon">🤖</span> ACTIVATE AI`;
        AiDirector.stop();
    }
});