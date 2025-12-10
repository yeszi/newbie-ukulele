<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { supabase } from './supabase'; 
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';

// --- IMPORT VISUALISASI JARING (WAJIB ADA UNTUK JARING WAJAH) ---
import { drawConnectors } from '@mediapipe/drawing_utils'; 
import { FACEMESH_TESSELATION, FACEMESH_RIGHT_EYE, FACEMESH_LEFT_EYE } from '@mediapipe/face_mesh'; 

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
const selectedSong = ref('basic'); // 'basic' atau 'laskar'

// --- CONFIG AUDIO ---
let audioContext = null;
let analyser = null;
let microphone = null;
let audioAnimationId = null;
const audioBuffer = new Float32Array(2048); 

// --- DATABASE CHORD ---

// 1. LATIHAN DASAR (Basic Chords)
const basicChords = [
  { name: 'C Major', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'A Minor', rootFreq: 440.00, dots: [{s:4, f:2}] }, 
  { name: 'F Major', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G Major', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  { name: 'E Minor', rootFreq: 329.63, dots: [{s:1, f:2}, {s:2, f:3}, {s:3, f:4}] }, 
  { name: 'D Minor', rootFreq: 293.66, dots: [{s:2, f:1}, {s:4, f:2}, {s:3, f:2}] }  
];

// 2. FULL LAGU: LASKAR PELANGI (Progressive Practice)
// Urutan chord disesuaikan dengan lirik lagu agar user bisa memainkannya
const laskarChords = [
  // Intro / Verse 1
  { name: 'C (Mimpi..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Adalah..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'C (Kunci..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Dunia..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'C (Berlarilah..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Tanpa Lelah..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G (Meraihnya..)', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  
  // Verse 2
  { name: 'C (Laskar..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Pelangi..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G (Takkan Terikat..)', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  { name: 'C (Waktu..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Bebaskan..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G (Mimpimu..)', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  
  // Chorus (Reff)
  { name: 'C (Menarilah..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Dan Tertawa..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G (Walau Dunia..)', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  { name: 'C (Tak Seindah..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Surga..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'G (Bersyukurlah..)', rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] }, 
  { name: 'C (Cinta Kita..)', rootFreq: 261.63, dots: [{s:1, f:3}] }, 
  { name: 'F (Di Dunia..)', rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] }, 
  { name: 'C (Selamanya..)', rootFreq: 261.63, dots: [{s:1, f:3}] }
];

const activeChordIndex = ref(0);

// Computed Property untuk memilih List Chord yang mana
const currentChordList = computed(() => {
  return selectedSong.value === 'laskar' ? laskarChords : basicChords;
});

const currentChord = computed(() => currentChordList.value[activeChordIndex.value]);

// --- METRIK SKRIPSI ---
let chordStartTime = 0;   
let tempEarData = [];     
let tempGazeData = [];    

// --- LOGIC LOGIN ---
const handleLogin = async () => {
  const inputName = username.value.trim();
  if (!inputName) { alert("Nama tidak boleh kosong!"); return; }
  isCheckingName.value = true; 
  try {
    const { data } = await supabase.from('tracking_logs').select('username').eq('username', inputName).limit(1);
    
    if (data && data.length > 0) {
      if (confirm(`Halo ${inputName}! Masuk Mode Latihan?`)) { isPracticeMode.value = true; currentStep.value = 'intro'; } 
      else { isCheckingName.value = false; return; }
    } else {
      isPracticeMode.value = false; currentStep.value = 'intro';
    }
  } catch (err) { alert("Koneksi bermasalah."); } finally { isCheckingName.value = false; }
};

// --- PILIH LAGU & MULAI ---
const selectSongAndStart = (songKey) => {
  selectedSong.value = songKey;
  startSession();
};

// --- TOMBOL KEMBALI ---
const goBack = () => {
  if(audioContext && audioContext.state !== 'closed') { audioContext.suspend(); }
  currentStep.value = 'intro';
  isSessionFinished.value = false;
  activeChordIndex.value = 0;
};

// --- AUDIO ENGINE ---
const startSession = async () => {
  try {
    status.value = "Menghubungkan Audio...";
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();

    // Cek mic
    if (!microphone) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; 
        microphone = audioContext.createMediaStreamSource(stream); microphone.connect(analyser);
    } else { await audioContext.resume(); }

    currentStep.value = 'belajar';
    status.value = selectedSong.value === 'laskar' ? "♫ Laskar Pelangi" : "Latihan Dasar";
    resetChordMetrics(); analyzeAudioLoop(); 
  } catch (err) { alert("Izin Mic ditolak! Refresh halaman."); }
};

// --- ALGORITMA AUDIO SENSITIF (0.02) ---
const autoCorrelate = (buf, sampleRate) => {
  let SIZE = buf.length; let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.02) return -1; 
  
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
  else { detectedPitch.value = 0; isPitchCorrect.value = false; }
  audioAnimationId = requestAnimationFrame(analyzeAudioLoop);
};

const checkPitchMatch = (hz) => {
  if (isSaving.value || isSessionFinished.value) return;
  const target = currentChord.value.rootFreq;
  // Toleransi 35Hz
  if (hz > (target - 35) && hz < (target + 35)) handleCorrectChord();
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
  if (activeChordIndex.value < currentChordList.value.length - 1) { 
    activeChordIndex.value++; resetChordMetrics(); 
  } else { finishSession(); }
};
const finishSession = () => { isSessionFinished.value = true; status.value = "Sesi Selesai!"; };
const handleRetrySameUser = () => {
  activeChordIndex.value = 0; isPitchCorrect.value = false; isSaving.value = false;
  isSessionFinished.value = false; resetChordMetrics(); 
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
  
  await supabase.from('tracking_logs').insert([{
    username: username.value, level: userLevel.value, chord_target: currentChord.value.name,
    duration_ms: duration, avg_ear: parseFloat(avgEar.toFixed(3)) || 0, avg_gaze: parseFloat(avgGaze.toFixed(3)) || 0,
    created_at: new Date().toISOString()
  }]);
};

// --- VISUALISASI JARING & WAJAH ---
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
    
    // Reset & Mirror
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    
    // Gambar Video
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      isWajahTerdeteksi.value = true;
      for (const landmarks of results.multiFaceLandmarks) {
        
        // Simpan Data
        if(!isSaving.value && !isSessionFinished.value && landmarks[468]) { 
           tempEarData.push(calculateEAR(landmarks)); 
           tempGazeData.push(calculateGaze(landmarks)); 
        }

        // ==========================================
        //  VISUALISASI JARING WAJAH (HIJAU NEON)
        // ==========================================
        if (drawConnectors && FACEMESH_TESSELATION) {
            drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, 
              {color: '#00FF00', lineWidth: 1}); 
        }

        // ==========================================
        //  VISUALISASI MATA (MERAH)
        // ==========================================
        if (drawConnectors && FACEMESH_RIGHT_EYE && FACEMESH_LEFT_EYE) {
             drawConnectors(ctx, landmarks, FACEMESH_RIGHT_EYE, {color: '#FF0000', lineWidth: 2});
             drawConnectors(ctx, landmarks, FACEMESH_LEFT_EYE, {color: '#FF0000', lineWidth: 2});
        }

        // ==========================================
        //  VISUALISASI TITIK TENGAH MATA (IRIS KUNING)
        // ==========================================
        if (landmarks[468] && landmarks[473]) {
            const leftIris = landmarks[468]; const rightIris = landmarks[473];
            ctx.fillStyle = "#FFFF00"; 
            ctx.beginPath(); ctx.arc(leftIris.x * canvas.width, leftIris.y * canvas.height, 4, 0, 2*Math.PI); ctx.fill();
            ctx.beginPath(); ctx.arc(rightIris.x * canvas.width, rightIris.y * canvas.height, 4, 0, 2*Math.PI); ctx.fill();
        }
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
      <div class="input-group"><label>Nama</label><input v-model="username" class="input-cozy" /></div>
      <div class="input-group"><label>Skill</label><select v-model="userLevel" class="input-cozy"><option value="pemula">Pemula</option><option value="mahir">Mahir</option></select></div>
      <button @click="handleLogin" class="btn-coffee" :disabled="isCheckingName">{{ isCheckingName ? 'Cek...' : 'Masuk' }}</button>
    </div>

    <div v-else-if="currentStep === 'intro'" class="card wood-panel fade-in">
      <h2>Halo, {{ username }}!</h2>
      <div class="note-paper"><p>Pilih materi latihan:</p></div>
      <div class="song-menu" style="display: flex; gap: 10px; flex-direction: column;">
        <button @click="selectSongAndStart('basic')" class="btn-leaf">🎹 Latihan Chord Dasar</button>
        <button @click="selectSongAndStart('laskar')" class="btn-coffee">🌈 Lagu: Laskar Pelangi</button>
      </div>
    </div>

    <div v-show="currentStep === 'belajar'" class="room-container fade-in">
      
      <div class="top-shelf">
        <button @click="goBack" class="btn-small-back">⬅ Kembali</button>
        <div class="status-badge" :class="isWajahTerdeteksi ? 'status-ok' : 'status-warn'">
          <span class="dot"></span> {{ isWajahTerdeteksi ? 'Wajah OK' : 'Cari Wajah...' }}
        </div>
        <div class="freq-badge" :style="{ background: detectedPitch > 0 ? '#D84315' : 'rgba(0,0,0,0.4)' }">
          {{ detectedPitch > 0 ? '🌊 GETARAN: ' + detectedPitch + ' Hz' : '🔇 MENUNGGU...' }}
        </div>
      </div>

      <div class="workspace">
        <div class="frame-wood" :class="{ 'pulse-success': isPitchCorrect }">
          <video ref="videoElement" class="input_video"></video>
          <canvas ref="canvasElement" class="output_canvas"></canvas>
          <div v-if="isPitchCorrect" class="success-stamp">BAGUS!</div>
        </div>

        <div class="chord-easel wood-panel">
          <div class="chord-visual">
            <svg width="140" height="160" viewBox="0 0 120 150" class="chord-svg">
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
            <span class="label-chord" style="color: #FF7043; font-weight: bold;">
              {{ selectedSong === 'laskar' ? '♫ Laskar Pelangi' : '♫ Latihan Dasar' }}
            </span>
            <h1 class="title-chord">{{ currentChord.name }}</h1>
            <p class="hz-info">Target: ±{{ currentChord.rootFreq }} Hz</p>
          </div>
          
          <div v-if="isSessionFinished" class="overlay-finished">
            <h1>Selesai!</h1>
            <button @click="handleRetrySameUser" class="btn-leaf">Ulangi</button>
            <button @click="goBack" class="btn-coffee">Ganti Lagu</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-small-back {
  background: rgba(0,0,0,0.5); border: 1px solid #aaa; color: white;
  padding: 5px 10px; border-radius: 10px; cursor: pointer;
  font-size: 0.8rem; margin-right: 10px;
}
.btn-small-back:hover { background: #555; }
</style>