<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { createClient } from '@supabase/supabase-js'; 
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils';
import { FACEMESH_TESSELATION } from '@mediapipe/face_mesh';

// --- CONFIG SUPABASE ---
const SUPABASE_URL = 'https://woqqpmfqjvfuidumpddr.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvcXFwbWZxanZmdWlkdW1wZGRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxOTU3NTMsImV4cCI6MjA4MDc3MTc1M30.ZkCA0vKttpL1tl-eXhi4M_TtMv8ddgeMhmRAUlbgr8c'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- STATE ---
const currentStep = ref('login'); 
const username = ref('');
const userLevel = ref('pemula');
const status = ref("Menyiapkan...");
const isCheckingName = ref(false); 
const isWajahTerdeteksi = ref(false);
const isSaving = ref(false);       
const detectedPitch = ref(0);      
const isPitchCorrect = ref(false); 
const isSessionFinished = ref(false);
const isPracticeMode = ref(false); 

// --- AUDIO ---
let audioContext = null;
let analyser = null;
let microphone = null;
let audioAnimationId = null;
const audioBuffer = new Float32Array(2048); 

// --- CHORD (Posisi titik disesuaikan biar SVG Jelas) ---
const activeChordIndex = ref(0);
const chords = [
  { name: 'C Major', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'A Minor', rootFreq: 440.00, dots: [{s:4, f:2}] }, 
  { name: 'F Major', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G Major', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  { name: 'E Minor', rootFreq: 329.63, dots: [{s:1, f:2}, {s:2, f:3}, {s:3, f:4}] }, 
  { name: 'D Minor', rootFreq: 293.66, dots: [{s:2, f:1}, {s:4, f:2}, {s:3, f:2}] }  
];
const currentChord = computed(() => chords[activeChordIndex.value]);

// --- METRIK ---
let chordStartTime = 0;   
let tempEarData = [];     
let tempGazeData = [];    

// --- LOGIC ---
const handleLogin = async () => {
  const inputName = username.value.trim();
  if (!inputName) { alert("Nama kosong!"); return; }
  isCheckingName.value = true; 
  try {
    const { data, error } = await supabase.from('tracking_logs').select('username').eq('username', inputName).limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      if(confirm(`Halo ${inputName}!\nData sudah ada. Masuk Mode Latihan?`)) {
        isPracticeMode.value = true; currentStep.value = 'intro';
      } else { isCheckingName.value = false; return; }
    } else {
      isPracticeMode.value = false; currentStep.value = 'intro';
    }
  } catch (err) { alert("Error DB"); } finally { isCheckingName.value = false; }
};

const startSession = async () => {
  try {
    status.value = "Koneksi Audio...";
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; 
    microphone = audioContext.createMediaStreamSource(stream); microphone.connect(analyser);
    currentStep.value = 'belajar'; status.value = isPracticeMode.value ? "Mode Latihan" : "Merekam";
    resetChordMetrics(); analyzeAudioLoop(); 
  } catch (err) { alert("Izin Mic Ditolak!"); }
};

const autoCorrelate = (buf, sampleRate) => {
  let SIZE = buf.length; let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE); if (rms < 0.05) return -1; 
  let r1 = 0, r2 = SIZE - 1, thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  buf = buf.slice(r1, r2); SIZE = buf.length;
  let c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] = c[i] + buf[j] * buf[j + i];
  let d = 0; while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  let T0 = maxpos; let x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  let a = (x1 + x3 - 2 * x2) / 2; let b = (x3 - x1) / 2; if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0; 
};

const analyzeAudioLoop = () => {
  if (currentStep.value !== 'belajar') return;
  analyser.getFloatTimeDomainData(audioBuffer);
  const pitch = autoCorrelate(audioBuffer, audioContext.sampleRate);
  if (pitch !== -1) { detectedPitch.value = Math.round(pitch); checkPitchMatch(pitch); } 
  else { isPitchCorrect.value = false; }
  audioAnimationId = requestAnimationFrame(analyzeAudioLoop);
};

const checkPitchMatch = (hz) => {
  if (isSaving.value || isSessionFinished.value) return;
  if (hz > (currentChord.value.rootFreq - 35) && hz < (currentChord.value.rootFreq + 35)) handleCorrectChord();
};

const handleCorrectChord = async () => {
  if (isSaving.value) return;
  isPitchCorrect.value = true; isSaving.value = true; 
  await saveToSupabase();
  setTimeout(() => { nextChord(); }, 1200); 
};

const resetChordMetrics = () => {
  chordStartTime = Date.now(); tempEarData = []; tempGazeData = [];
  isPitchCorrect.value = false; isSaving.value = false; detectedPitch.value = 0;
};
const nextChord = () => {
  if (activeChordIndex.value < chords.length - 1) { activeChordIndex.value++; resetChordMetrics(); } 
  else { finishSession(); }
};
const finishSession = () => { isSessionFinished.value = true; status.value = "Selesai!"; };
const handleRetrySameUser = () => {
  isPracticeMode.value = true; isSessionFinished.value = false; activeChordIndex.value = 0;
  isPitchCorrect.value = false; isSaving.value = false; resetChordMetrics(); status.value = "Mode Latihan";
};
const handleLogout = () => {
  username.value = ''; activeChordIndex.value = 0; isPitchCorrect.value = false; isSaving.value = false;
  isSessionFinished.value = false; isPracticeMode.value = false; currentStep.value = 'login';
};

const saveToSupabase = async () => {
  if (isPracticeMode.value) return; 
  const endTime = Date.now(); const duration = endTime - chordStartTime; 
  const sumEar = tempEarData.reduce((a, b) => a + b, 0); const avgEar = tempEarData.length > 0 ? (sumEar / tempEarData.length) : 0;
  const sumGaze = tempGazeData.reduce((a, b) => a + b, 0); const avgGaze = tempGazeData.length > 0 ? (sumGaze / tempGazeData.length) : 0;
  const payload = {
    username: username.value, level: userLevel.value, chord_target: currentChord.value.name,
    duration_ms: duration, avg_ear: parseFloat(avgEar.toFixed(3)) || 0, avg_gaze: parseFloat(avgGaze.toFixed(3)) || 0,
    created_at: new Date().toISOString()
  };
  await supabase.from('tracking_logs').insert([payload]);
};

// --- MEDIAPIPE ---
const videoElement = ref(null); const canvasElement = ref(null);
const getDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
const calculateEAR = (landmarks) => getDistance(landmarks[159], landmarks[145]) / getDistance(landmarks[33], landmarks[133]);
const calculateGaze = (landmarks) => getDistance(landmarks[468], landmarks[33]) / getDistance(landmarks[468], landmarks[133]);

const onResults = (results) => {
  if (currentStep.value !== 'belajar') return;
  const canvas = canvasElement.value; const video = videoElement.value;
  if(canvas && video) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(-1, 1); ctx.translate(-canvas.width, 0);
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      isWajahTerdeteksi.value = true;
      for (const landmarks of results.multiFaceLandmarks) {
        if(!isSaving.value && !isSessionFinished.value) { tempEarData.push(calculateEAR(landmarks)); tempGazeData.push(calculateGaze(landmarks)); }
        drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {color: '#D7CCC850', lineWidth: 0.5}); 
        const iris = landmarks[468]; ctx.beginPath(); ctx.arc(iris.x*canvas.width, iris.y*canvas.height, 4, 0, 2*Math.PI); ctx.fillStyle = "#FF7043"; ctx.fill(); 
      } 
    } else { isWajahTerdeteksi.value = false; }
    ctx.restore();
  }
}
onMounted(() => {
  const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  faceMesh.onResults(onResults);
  if (videoElement.value) {
    const camera = new Camera(videoElement.value, { onFrame: async () => { await faceMesh.send({image: videoElement.value}); }, width: 640, height: 480 });
    camera.start();
  }
});
</script>

<template>
  <div class="main-container">
    
    <div v-if="currentStep === 'login'" class="card wood-panel fade-in">
      <h1>🎸 Ukulele <span class="highlight">CozyTrack</span></h1>
      <p class="subtitle">Santai, Mainkan, & Rekam Datanya</p>
      
      <div class="input-group">
        <label>Nama Kamu</label>
        <input v-model="username" type="text" placeholder="Isi nama..." class="input-cozy" :disabled="isCheckingName" />
      </div>
      
      <div class="input-group">
        <label>Skill</label>
        <select v-model="userLevel" class="input-cozy" :disabled="isCheckingName">
          <option value="pemula">🌱 Pemula</option>
          <option value="mahir">☕ Mahir</option>
        </select>
      </div>

      <button @click="handleLogin" class="btn-coffee" :disabled="isCheckingName">
        {{ isCheckingName ? 'Cek...' : 'Masuk' }}
      </button>
    </div>

    <div v-else-if="currentStep === 'intro'" class="card wood-panel fade-in">
      <h2>Halo, {{ username }}! 🍂</h2>
      
      <div v-if="isPracticeMode" class="badge-practice-large">⚠️ MODE LATIHAN (TIDAK DIREKAM)</div>
      <div v-else class="badge-record-large">🔴 MODE PEREKAMAN DATA</div>

      <div class="note-paper">
        <p>1. Izinkan Kamera & Mic.</p>
        <p>2. Pastikan wajah masuk frame.</p>
        <p>3. Genjreng ukulele!</p>
      </div>
      <button @click="startSession" class="btn-leaf">Mulai!</button>
    </div>

    <div v-show="currentStep === 'belajar'" class="room-container">
      
      <div class="top-shelf">
        <div class="status-badge" :class="isWajahTerdeteksi ? 'status-ok' : 'status-warn'">
           <span class="dot"></span> {{ isWajahTerdeteksi ? 'Wajah OK' : 'Cari...' }}
        </div>
        <div class="freq-badge">🎵 {{ detectedPitch }} Hz</div>
        <div v-if="isPracticeMode" class="practice-badge">☕ LATIHAN</div>
        <div v-else class="record-badge">🔴 REKAM</div>
      </div>

      <div class="workspace">
        
        <div class="frame-wood" :class="{ 'pulse-success': isPitchCorrect }">
          <video ref="videoElement" class="input_video"></video>
          <canvas ref="canvasElement" class="output_canvas"></canvas>
          <div v-if="isPitchCorrect" class="success-stamp">
             {{ isPracticeMode ? 'PAS!' : 'SAVED!' }}
          </div>
        </div>

        <div class="chord-easel wood-panel">
          <div class="chord-visual">
            <svg viewBox="0 0 140 160" class="chord-svg">
              <rect x="20" y="10" width="100" height="12" fill="#3E2723" rx="2" />
              
              <line x1="20" y1="20" x2="20" y2="150" stroke="#5D4037" stroke-width="3"/>
              <line x1="53" y1="20" x2="53" y2="150" stroke="#5D4037" stroke-width="3"/>
              <line x1="86" y1="20" x2="86" y2="150" stroke="#5D4037" stroke-width="3"/>
              <line x1="120" y1="20" x2="120" y2="150" stroke="#5D4037" stroke-width="3"/>
              
              <line x1="20" y1="50" x2="120" y2="50" stroke="#8D6E63" stroke-width="4"/>
              <line x1="20" y1="90" x2="120" y2="90" stroke="#8D6E63" stroke-width="4"/>
              <line x1="20" y1="130" x2="120" y2="130" stroke="#8D6E63" stroke-width="4"/>
              
              <circle v-for="(dot, i) in currentChord.dots" :key="i"
                :cx="dot.s === 4 ? 20 : dot.s === 3 ? 53 : dot.s === 2 ? 86 : 120"
                :cy="dot.f === 1 ? 35 : dot.f === 2 ? 70 : dot.f === 3 ? 110 : 140"
                r="12" fill="#D84315" stroke="#fff" stroke-width="3" />
            </svg>
          </div>

          <div class="chord-info">
            <span class="label-chord">Kunci</span>
            <h1 class="title-chord">{{ currentChord.name }}</h1>
          </div>
          
          <div v-if="isSessionFinished" class="overlay-finished fade-in">
            <h1>Selesai!</h1>
            <div class="action-buttons">
              <button @click="handleRetrySameUser" class="btn-leaf btn-action">🔄 Lagi</button>
              <button @click="handleLogout" class="btn-coffee btn-action">🚪 Keluar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Global Reset */
body { margin: 0; padding: 0; box-sizing: border-box; background: #21120e; }
</style>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap');

:root {
  --bg-dark: #3E2723; --bg-light: #4E342E;
  --text-cream: #EFEBE9; --accent-terra: #D84315; --accent-leaf: #66BB6A;
}

/* CONTAINER UTAMA (Scrollable di HP) */
.main-container { 
  font-family: 'Nunito', sans-serif; 
  display: flex; flex-direction: column; align-items: center; 
  min-height: 100vh; width: 100%;
  background: linear-gradient(135deg, #3E2723 0%, #21120e 100%); 
  color: var(--text-cream); 
  padding: 20px; box-sizing: border-box; overflow-y: auto;
}

/* CARD STYLES (Login & Intro) */
.wood-panel {
  background: rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; 
  padding: 30px; 
  width: 90%; max-width: 400px; /* Responsive Width */
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin: auto; position: relative;
}

.note-paper { background: #FFF3E0; color: #5D4037; padding: 15px; border-radius: 10px; text-align: left; margin: 20px 0; }
h1 { color: #FFCC80; margin-bottom: 5px; font-weight: 900; }
h2 { color: #FFCC80; font-size: 1.5rem; margin-bottom: 15px; }

/* INPUTS */
.input-group { margin-bottom: 15px; text-align: left; }
.input-cozy {
  width: 100%; padding: 12px; background: rgba(0,0,0,0.3); 
  border: 2px solid #5D4037; border-radius: 10px; color: #FFF; font-size: 1rem;
  box-sizing: border-box; transition: 0.3s;
}
.btn-coffee, .btn-leaf { 
  width: 100%; padding: 12px; border: none; border-radius: 10px; 
  font-weight: 800; font-size: 1rem; cursor: pointer; margin-top: 10px;
}
.btn-coffee { background: #D84315; color: white; }
.btn-leaf { background: #66BB6A; color: #1B5E20; }

/* --- MAIN APP LAYOUT --- */
.room-container {
  width: 100%; max-width: 1200px; 
  display: flex; flex-direction: column; gap: 20px; align-items: center;
}

/* STATUS BAR (Flexible) */
.top-shelf { 
  display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; width: 100%;
}
.status-badge, .freq-badge, .practice-badge, .record-badge {
  background: rgba(0,0,0,0.4); padding: 8px 16px; border-radius: 20px;
  font-weight: 700; display: flex; align-items: center; gap: 6px; font-size: 0.9rem;
  border: 1px solid rgba(255,255,255,0.1); white-space: nowrap;
}
.practice-badge { color: #FFD54F; border-color: #FFD54F; }
.record-badge { color: #FF5252; border-color: #FF5252; animation: blink 2s infinite; }
@keyframes blink { 0% {opacity: 1} 50% {opacity: 0.5} 100% {opacity: 1} }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #ccc; }
.status-ok .dot { background: #66BB6A; box-shadow: 0 0 8px #66BB6A; }
.status-warn .dot { background: #FF7043; }

/* WORKSPACE: Wrapper untuk Kamera & Chord */
.workspace {
  display: flex; 
  flex-direction: column; /* DEFAULT: MOBILE (ATAS BAWAH) */
  gap: 20px; 
  align-items: center; 
  justify-content: center; 
  width: 100%;
}

/* --- KAMERA RESPONSIVE --- */
.frame-wood {
  position: relative; 
  width: 100%;  /* Full width di Mobile */
  max-width: 640px; /* Batas maksimal */
  aspect-ratio: 4/3; /* Jaga rasio agar tidak gepeng */
  border: 8px solid #5D4037; border-radius: 15px; overflow: hidden;
  background: black; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}
.input_video { display: none; }
.output_canvas { width: 100%; height: 100%; object-fit: cover; }
.pulse-success { border-color: #66BB6A; box-shadow: 0 0 30px #66BB6A; }
.success-stamp {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-10deg);
  font-size: 2rem; font-weight: 900; color: #66BB6A;
  border: 5px solid #66BB6A; padding: 10px 20px; border-radius: 10px;
  background: rgba(255,255,255,0.9); z-index: 5;
}

/* --- CHORD PANEL RESPONSIVE --- */
.chord-easel {
  width: 100%; max-width: 400px; /* Responsive Width */
  background: #FFF3E0; color: #3E2723;
  padding: 20px; 
  display: flex; 
  flex-direction: row; /* Mobile: Kiri (Gambar) - Kanan (Teks) */
  align-items: center; justify-content: space-around;
  border-radius: 20px; box-shadow: 0 10px 20px rgba(0,0,0,0.3);
  position: relative;
}

.chord-visual {
  background: #fff; padding: 5px; border-radius: 15px; border: 3px solid #8D6E63;
  width: 120px; height: 140px; /* Ukuran Fix biar jelas */
  flex-shrink: 0;
}
.chord-svg { width: 100%; height: 100%; }

.chord-info {
  text-align: left; margin-left: 15px; flex-grow: 1;
}
.label-chord { font-size: 0.8rem; text-transform: uppercase; color: #8D6E63; font-weight: bold; }
.title-chord { color: #D84315; font-size: 2.5rem; margin: 0; line-height: 1; }

/* OVERLAY FINISHED */
.overlay-finished {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(62, 39, 35, 0.98); border-radius: 20px; z-index: 10;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  color: #FFCC80; animation: fadeIn 0.3s; padding: 20px; box-sizing: border-box;
}
.action-buttons { display: flex; gap: 10px; margin-top: 15px; flex-direction: column; width: 100%; }
.badge-practice-large { background: #FFD54F; color: #5D4037; font-weight: bold; padding: 10px; border-radius: 8px; margin-bottom: 10px; animation: pulse 2s infinite; }
.badge-record-large { background: #FF5252; color: white; font-weight: bold; padding: 10px; border-radius: 8px; margin-bottom: 10px; }
.fade-in { animation: fadeIn 0.8s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

/* ========================================= */
/* === MEDIA QUERY: DESKTOP (> 900px)    === */
/* ========================================= */
@media (min-width: 900px) {
  /* Layout jadi Kiri - Kanan */
  .workspace {
    flex-direction: row; 
    align-items: flex-start;
  }
  
  /* Kamera fix width desktop */
  .frame-wood {
    width: 640px;
  }

  /* Panel Chord jadi Memanjang ke Bawah */
  .chord-easel {
    width: 300px;
    flex-direction: column; /* Gambar Atas, Teks Bawah */
    text-align: center;
  }
  
  .chord-visual {
    width: 140px; height: 160px; /* Lebih besar di desktop */
    margin-bottom: 15px;
  }
  
  .chord-info {
    margin-left: 0; text-align: center;
  }
}
</style>