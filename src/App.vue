<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { createClient } from '@supabase/supabase-js'; 
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils';
import { FACEMESH_TESSELATION } from '@mediapipe/face_mesh';

// --- 1. CONFIG SUPABASE ---
const SUPABASE_URL = 'https://woqqpmfqjvfuidumpddr.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvcXFwbWZxanZmdWlkdW1wZGRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxOTU3NTMsImV4cCI6MjA4MDc3MTc1M30.ZkCA0vKttpL1tl-eXhi4M_TtMv8ddgeMhmRAUlbgr8c'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- STATE UTAMA ---
const currentStep = ref('login'); 
const username = ref('');
const userLevel = ref('pemula');
const status = ref("Menyiapkan Ruang Belajar...");
const isCheckingName = ref(false); 

// --- STATE DETEKSI & DATA ---
const isWajahTerdeteksi = ref(false);
const isSaving = ref(false);       
const detectedPitch = ref(0);      
const isPitchCorrect = ref(false); 
const isSessionFinished = ref(false);
const isPracticeMode = ref(false); 

// --- CONFIG AUDIO ---
let audioContext = null;
let analyser = null;
let microphone = null;
let audioAnimationId = null;
const audioBuffer = new Float32Array(2048); 

// --- DATABASE CHORD ---
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

// --- METRIK SKRIPSI ---
let chordStartTime = 0;   
let tempEarData = [];     
let tempGazeData = [];    

// --- LOGIN LOGIC ---
const handleLogin = async () => {
  const inputName = username.value.trim();
  if (!inputName) { alert("Nama tidak boleh kosong!"); return; }
  isCheckingName.value = true; 
  try {
    const { data, error } = await supabase.from('tracking_logs').select('username').eq('username', inputName).limit(1);
    if (error) throw error;

    if (data && data.length > 0) {
      const confirmPractice = confirm(`Halo ${inputName}! 👋\nData kamu sudah ada.\nOK = Mode Latihan (No Save)\nCancel = Ganti Nama`);
      if (confirmPractice) {
        isPracticeMode.value = true; 
        currentStep.value = 'intro';
      } else {
        isCheckingName.value = false; return;
      }
    } else {
      isPracticeMode.value = false; 
      currentStep.value = 'intro';
    }
  } catch (err) {
    console.error("Error DB:", err.message); alert("Koneksi bermasalah.");
  } finally {
    isCheckingName.value = false; 
  }
};

// --- AUDIO ENGINE ---
const startSession = async () => {
  try {
    status.value = "Menghubungkan Audio...";
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048; 
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);

    currentStep.value = 'belajar';
    status.value = isPracticeMode.value ? "Mode Latihan" : "Mode Perekaman";
    resetChordMetrics(); 
    analyzeAudioLoop(); 
  } catch (err) {
    alert("Izin Mic ditolak: " + err.message);
  }
};

// --- PITCH DETECTION ---
const autoCorrelate = (buf, sampleRate) => {
  let SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.05) return -1; 

  let r1 = 0, r2 = SIZE - 1, thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }

  buf = buf.slice(r1, r2);
  SIZE = buf.length;
  let c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE - i; j++) c[i] = c[i] + buf[j] * buf[j + i];
  let d = 0; while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  
  let T0 = maxpos;
  let x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  let a = (x1 + x3 - 2 * x2) / 2;
  let b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0; 
};

const analyzeAudioLoop = () => {
  if (currentStep.value !== 'belajar') return;
  analyser.getFloatTimeDomainData(audioBuffer);
  const pitch = autoCorrelate(audioBuffer, audioContext.sampleRate);
  if (pitch !== -1) {
    detectedPitch.value = Math.round(pitch);
    checkPitchMatch(pitch); 
  } else {
    isPitchCorrect.value = false; 
  }
  audioAnimationId = requestAnimationFrame(analyzeAudioLoop);
};

const checkPitchMatch = (hz) => {
  if (isSaving.value || isSessionFinished.value) return;
  const target = currentChord.value.rootFreq;
  const tolerance = 35; 
  if (hz > (target - tolerance) && hz < (target + tolerance)) {
    handleCorrectChord();
  }
};

const handleCorrectChord = async () => {
  if (isSaving.value) return;
  console.log("✅ Nada Pas!");
  isPitchCorrect.value = true;
  isSaving.value = true; 
  await saveToSupabase();
  setTimeout(() => { nextChord(); }, 1200); 
};

const resetChordMetrics = () => {
  chordStartTime = Date.now(); 
  tempEarData = []; tempGazeData = [];
  isPitchCorrect.value = false;
  isSaving.value = false;
  detectedPitch.value = 0;
};

const nextChord = () => {
  if (activeChordIndex.value < chords.length - 1) {
    activeChordIndex.value++;
    resetChordMetrics(); 
  } else {
    finishSession(); 
  }
};

const finishSession = () => {
  isSessionFinished.value = true;
  status.value = "Sesi Selesai!";
};

const handleRetrySameUser = () => {
  isPracticeMode.value = true; 
  isSessionFinished.value = false;
  activeChordIndex.value = 0;
  isPitchCorrect.value = false;
  isSaving.value = false;
  resetChordMetrics();
  status.value = "Mode Latihan";
};

const handleLogout = () => {
  username.value = '';
  activeChordIndex.value = 0;
  isPitchCorrect.value = false;
  isSaving.value = false;
  isSessionFinished.value = false;
  isPracticeMode.value = false; 
  currentStep.value = 'login';
};

const saveToSupabase = async () => {
  if (isPracticeMode.value) return; 
  const endTime = Date.now();
  const duration = endTime - chordStartTime; 
  const sumEar = tempEarData.reduce((a, b) => a + b, 0);
  const avgEar = tempEarData.length > 0 ? (sumEar / tempEarData.length) : 0;
  const sumGaze = tempGazeData.reduce((a, b) => a + b, 0);
  const avgGaze = tempGazeData.length > 0 ? (sumGaze / tempGazeData.length) : 0;

  const payload = {
    username: username.value,
    level: userLevel.value,
    chord_target: currentChord.value.name,
    duration_ms: duration,       
    avg_ear: parseFloat(avgEar.toFixed(3)) || 0,
    avg_gaze: parseFloat(avgGaze.toFixed(3)) || 0,
    created_at: new Date().toISOString()
  };

  const { error } = await supabase.from('tracking_logs').insert([payload]);
  if (error) console.error("DB Error:", error.message);
  else console.log("✅ Data Tersimpan");
};

// --- MEDIA PIPE ---
const videoElement = ref(null);
const canvasElement = ref(null);
const getDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
const calculateEAR = (landmarks) => {
  const distVertical = getDistance(landmarks[159], landmarks[145]);
  const distHorizontal = getDistance(landmarks[33], landmarks[133]);
  return distHorizontal === 0 ? 0 : distVertical / distHorizontal;
};
const calculateGaze = (landmarks) => {
  const irisCenter = landmarks[468]; 
  const eyeLeftCorner = landmarks[33]; 
  const eyeRightCorner = landmarks[133]; 
  const distLeft = getDistance(irisCenter, eyeLeftCorner);
  const distRight = getDistance(irisCenter, eyeRightCorner);
  return distRight === 0 ? 0 : distLeft / distRight; 
};

const onResults = (results) => {
  if (currentStep.value !== 'belajar') return;
  const canvas = canvasElement.value;
  const video = videoElement.value;
  
  if(canvas && video) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      isWajahTerdeteksi.value = true;
      for (const landmarks of results.multiFaceLandmarks) {
        if(!isSaving.value && !isSessionFinished.value) {
            tempEarData.push(calculateEAR(landmarks));
            tempGazeData.push(calculateGaze(landmarks));
        }
        drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {color: '#D7CCC850', lineWidth: 0.5}); 
        const iris = landmarks[468];
        ctx.beginPath(); 
        ctx.arc(iris.x*canvas.width, iris.y*canvas.height, 4, 0, 2*Math.PI); 
        ctx.fillStyle = "#FF7043"; 
        ctx.fill(); 
      } 
    } else {
      isWajahTerdeteksi.value = false;
    }
    ctx.restore();
  }
}

onMounted(() => {
  const faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
  faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  faceMesh.onResults(onResults);
  if (videoElement.value) {
    const camera = new Camera(videoElement.value, {
      onFrame: async () => { await faceMesh.send({image: videoElement.value}); },
      width: 640, height: 480
    });
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
        <input v-model="username" type="text" placeholder="Tulis nama disini..." class="input-cozy" :disabled="isCheckingName" />
      </div>
      
      <div class="input-group">
        <label>Level Skill</label>
        <select v-model="userLevel" class="input-cozy" :disabled="isCheckingName">
          <option value="pemula">🌱 Baru Belajar</option>
          <option value="mahir">☕ Sudah Mahir</option>
        </select>
      </div>

      <button @click="handleLogin" class="btn-coffee" :disabled="isCheckingName">
        {{ isCheckingName ? 'Mengecek Data...' : 'Masuk Ruangan' }}
      </button>
    </div>

    <div v-else-if="currentStep === 'intro'" class="card wood-panel fade-in">
      <h2>Halo, {{ username }}! 🍂</h2>
      
      <div v-if="isPracticeMode" class="badge-practice-large">
        ⚠️ MODE LATIHAN (TIDAK DIREKAM)
      </div>
      <div v-else class="badge-record-large">
        🔴 MODE PEREKAMAN DATA
      </div>

      <div class="note-paper">
        <p><b>Status:</b> {{ isPracticeMode ? 'User Lama' : 'User Baru' }}</p>
        <p><b>Cara Main:</b></p>
        <p>1. Izinkan akses Kamera & Mic.</p>
        <p>2. Mainkan chord yang diminta.</p>
      </div>
      <button @click="startSession" class="btn-leaf">Mulai Sesi</button>
    </div>

    <div v-show="currentStep === 'belajar'" class="room-container fade-in">
      
      <div class="top-shelf">
        <div class="status-group">
          <div class="status-badge" :class="isWajahTerdeteksi ? 'status-ok' : 'status-warn'">
            <span class="dot"></span> {{ isWajahTerdeteksi ? 'Wajah OK' : 'Cari Wajah' }}
          </div>
          <div class="freq-badge">🎵 {{ detectedPitch }} Hz</div>
        </div>

        <div v-if="isPracticeMode" class="practice-badge">☕ LATIHAN</div>
        <div v-else class="record-badge">🔴 REKAM</div>
      </div>

      <div class="workspace">
        <div class="frame-wood" :class="{ 'pulse-success': isPitchCorrect }">
          <video ref="videoElement" class="input_video"></video>
          <canvas ref="canvasElement" class="output_canvas"></canvas>
          <div v-if="isPitchCorrect" class="success-stamp">
             {{ isPracticeMode ? '✨ LANJUT!' : '✨ SAVED!' }}
          </div>
        </div>

        <div class="chord-easel wood-panel">
          <div class="chord-visual">
            <svg viewBox="0 0 120 150" class="chord-svg">
              <rect x="10" y="10" width="100" height="8" fill="#5D4037" rx="2" />
              <line x1="10" y1="18" x2="10" y2="140" stroke="#8D6E63" stroke-width="2"/>
              <line x1="43" y1="18" x2="43" y2="140" stroke="#8D6E63" stroke-width="2"/>
              <line x1="76" y1="18" x2="76" y2="140" stroke="#8D6E63" stroke-width="2"/>
              <line x1="110" y1="18" x2="110" y2="140" stroke="#8D6E63" stroke-width="2"/>
              <line x1="10" y1="50" x2="110" y2="50" stroke="#A1887F" stroke-width="2"/>
              <line x1="10" y1="90" x2="110" y2="90" stroke="#A1887F" stroke-width="2"/>
              <line x1="10" y1="130" x2="110" y2="130" stroke="#A1887F" stroke-width="2"/>
              <circle v-for="(dot, i) in currentChord.dots" :key="i"
                :cx="dot.s === 4 ? 10 : dot.s === 3 ? 43 : dot.s === 2 ? 76 : 110"
                :cy="dot.f === 1 ? 35 : dot.f === 2 ? 70 : dot.f === 3 ? 110 : 140"
                r="10" fill="#D84315" stroke="#fff" stroke-width="2" />
            </svg>
          </div>

          <div class="chord-info">
            <h1 class="title-chord">{{ currentChord.name }}</h1>
            <p class="hz-info">Target: ±{{ currentChord.rootFreq }} Hz</p>
          </div>
          
          <div v-if="isSessionFinished" class="overlay-finished fade-in">
            <h1>🎉 Selesai!</h1>
            <p class="finished-sub">
              {{ isPracticeMode ? 'Sesi Latihan Berakhir.' : 'Data Perekaman Tersimpan.' }}
            </p>
            <div class="action-buttons">
              <button @click="handleRetrySameUser" class="btn-leaf btn-action">🔄 Latihan Lagi</button>
              <button @click="handleLogout" class="btn-coffee btn-action">🚪 Ganti Peserta</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap');

:root {
  --bg-dark: #3E2723; --bg-light: #4E342E; --card-bg: rgba(78, 52, 46, 0.95);
  --text-cream: #EFEBE9; --accent-terra: #D84315; --accent-leaf: #66BB6A;
}

.main-container { 
  font-family: 'Nunito', sans-serif; display: flex; justify-content: center; align-items: center; 
  min-height: 100vh; background: linear-gradient(135deg, #3E2723 0%, #21120e 100%); 
  color: var(--text-cream); overflow-y: auto; padding: 10px; box-sizing: border-box;
}

/* --- CARD STYLES --- */
.wood-panel {
  background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1); padding: 30px; border-radius: 20px; 
  width: 100%; max-width: 420px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  position: relative; 
}
.note-paper { background: #FFF3E0; color: #5D4037; padding: 15px; border-radius: 10px; text-align: left; margin: 20px 0; }
.note-paper p { margin: 5px 0; font-weight: 600; font-size: 0.9rem; }
h1 { color: #FFCC80; margin-bottom: 5px; font-weight: 900; }
h2 { color: #FFCC80; font-size: 1.5rem; margin-bottom: 15px; }
.subtitle { color: #BCAAA4; font-size: 0.9rem; margin-bottom: 25px; }

/* --- INPUTS & BUTTONS --- */
.input-group { text-align: left; margin-bottom: 15px; }
.input-group label { display: block; color: #D7CCC8; font-size: 0.85rem; margin-bottom: 5px; margin-left: 5px; }
.input-cozy {
  width: 100%; padding: 14px; background: rgba(0,0,0,0.2); 
  border: 2px solid #5D4037; border-radius: 12px; color: #FFF; font-family: inherit;
  box-sizing: border-box; transition: 0.3s;
}
.input-cozy:focus { border-color: #FFCC80; outline: none; background: rgba(0,0,0,0.4); }
.btn-coffee, .btn-leaf { width: 100%; padding: 15px; border: none; border-radius: 12px; font-weight: 800; font-size: 1rem; cursor: pointer; transition: 0.2s; }
.btn-coffee { background: #D84315; color: white; box-shadow: 0 4px 0 #BF360C; }
.btn-leaf { background: #66BB6A; color: #1B5E20; box-shadow: 0 4px 0 #388E3C; }
.btn-coffee:active, .btn-leaf:active { transform: translateY(4px); box-shadow: none; }

/* --- WORKSPACE (RESPONSIVE) --- */
.room-container {
  display: flex; flex-direction: column; align-items: center; 
  width: 100%; min-height: 100vh; padding-top: 10px;
}

.top-shelf { 
  display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-bottom: 15px; width: 100%;
}
.status-group { display: flex; gap: 10px; }
.status-badge, .freq-badge, .practice-badge, .record-badge {
  background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 20px;
  font-weight: 700; display: flex; align-items: center; gap: 6px; font-size: 0.8rem;
  border: 1px solid rgba(255,255,255,0.1); white-space: nowrap;
}
.practice-badge { color: #FFD54F; border-color: #FFD54F; }
.record-badge { color: #FF5252; border-color: #FF5252; animation: blink 2s infinite; }
@keyframes blink { 0% {opacity: 1} 50% {opacity: 0.5} 100% {opacity: 1} }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; }
.status-ok .dot { background: #66BB6A; box-shadow: 0 0 8px #66BB6A; }
.status-warn .dot { background: #FF7043; }

.workspace {
  display: flex; gap: 20px; align-items: center; justify-content: center;
  width: 100%; max-width: 1000px;
  /* RESPONSIVE LOGIC */
  flex-direction: column; /* Default Mobile: Stack ke bawah */
}

/* Desktop Styles (Screen > 900px) */
@media (min-width: 900px) {
  .workspace { flex-direction: row; align-items: flex-start; }
  .frame-wood { width: 640px !important; } /* Fix width di desktop */
  .chord-easel { width: 280px; }
}

/* FRAME KAMERA (RESPONSIVE) */
.frame-wood {
  position: relative; 
  width: 100%; /* Full width di HP */
  max-width: 640px; /* Mentok di 640px */
  aspect-ratio: 4/3; /* Jaga rasio kamera */
  border: 8px solid #5D4037; border-radius: 15px; overflow: hidden;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5); background: #000;
  transition: 0.3s;
}
.frame-wood.pulse-success { border-color: #66BB6A; transform: scale(1.02); }
.input_video { display: none; }
.output_canvas { width: 100%; height: 100%; object-fit: cover; }

/* PANEL CHORD DI KANAN/BAWAH */
.chord-easel {
  width: 100%; max-width: 350px;
  padding: 20px; display: flex; flex-direction: column; align-items: center;
  background: #FFF3E0; color: #3E2723;
}
.chord-visual {
  background: #fff; padding: 10px; border-radius: 15px; border: 2px solid #8D6E63;
  margin-bottom: 15px; box-shadow: inset 0 0 10px rgba(0,0,0,0.1); width: 100px; height: 120px;
}
.chord-svg { width: 100%; height: 100%; }

.title-chord { color: #D84315; font-size: 2rem; margin: 0; line-height: 1.2; }
.label-chord { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: #8D6E63; font-weight: bold; }
.hz-info { font-size: 0.8rem; color: #5D4037; opacity: 0.7; margin-top: 5px; }

/* STAMP SUKSES */
.success-stamp {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-10deg);
  font-size: 2rem; font-weight: 900; color: #66BB6A;
  border: 4px solid #66BB6A; padding: 10px 20px; border-radius: 10px;
  background: rgba(255,255,255,0.9); box-shadow: 0 10px 20px rgba(0,0,0,0.3);
  animation: stampIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes stampIn { from { opacity: 0; transform: translate(-50%, -50%) scale(2); } to { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(-10deg); } }

/* OVERLAY FINISHED */
.overlay-finished {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(62, 39, 35, 0.98); border-radius: 20px; z-index: 10;
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  color: #FFCC80; animation: fadeIn 0.3s; padding: 20px; box-sizing: border-box;
}
.finished-sub { color: #D7CCC8; margin-bottom: 20px; font-size: 0.9rem; }
.action-buttons { width: 100%; display: flex; flex-direction: column; gap: 10px; }
.btn-action { margin: 0; padding: 12px; font-size: 0.9rem; }
.badge-practice-large { background: #FFD54F; color: #5D4037; font-weight: bold; padding: 10px; border-radius: 8px; margin-bottom: 10px; animation: pulse 2s infinite; }
.badge-record-large { background: #FF5252; color: white; font-weight: bold; padding: 10px; border-radius: 8px; margin-bottom: 10px; }
.fade-in { animation: fadeIn 0.8s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
</style>