<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from 'vue';
import { supabase } from './supabase'; 
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors } from '@mediapipe/drawing_utils'; 
import { FACEMESH_TESSELATION, FACEMESH_RIGHT_EYE, FACEMESH_LEFT_EYE } from '@mediapipe/face_mesh'; 

// --- STATE UTAMA ---
const currentStep = ref('login'); 
const username = ref('');
const userLevel = ref('pemula');
const status = ref("Menyiapkan...");
const isCheckingName = ref(false); 

// --- STATE ADMIN ---
const showAdminLogin = ref(false);
const adminEmail = ref('');
const adminPassword = ref('');
const isLoggingIn = ref(false);
const newSongTitle = ref('');
const newSongSlug = ref('');
const newSongSequence = ref([]);
const selectedBaseChord = ref('C Major');
const chordCustomLabel = ref('');
const editingSongId = ref(null); 

const LIBRARY_CHORDS = {
  'C Major': { rootFreq: 261.63, dots: [{s:1, f:3}] },
  'A Minor': { rootFreq: 440.00, dots: [{s:4, f:2}] },
  'F Major': { rootFreq: 349.23, dots: [{s:2, f:1}, {s:4, f:2}] },
  'G Major': { rootFreq: 392.00, dots: [{s:3, f:2}, {s:1, f:2}, {s:2, f:3}] },
  'E Minor': { rootFreq: 329.63, dots: [{s:1, f:2}, {s:2, f:3}, {s:3, f:4}] },
  'D Minor': { rootFreq: 293.66, dots: [{s:2, f:1}, {s:4, f:2}, {s:3, f:2}] }
};

// --- STATE APP ---
const isWajahTerdeteksi = ref(false);
const isSaving = ref(false);       
const detectedPitch = ref(0);      
const isPitchCorrect = ref(false); 
const isSessionFinished = ref(false);
const isPracticeMode = ref(false);
const selectedSongTitle = ref(''); 
const songChords = ref([]); 
const activeChordIndex = ref(0);
const availableSongs = ref([]); 
const isLoadingMenu = ref(false);

const currentChord = computed(() => {
  if (songChords.value.length === 0) return { name: 'Loading...', rootFreq: 0, dots: [] };
  return songChords.value[activeChordIndex.value];
});

// --- AUDIO VARS ---
let audioContext = null;
let analyser = null;
let microphone = null;
let audioAnimationId = null;
const audioBuffer = new Float32Array(2048); 

// --- METRIK MACHINE LEARNING (DATA POINT) ---
let chordStartTime = 0;   
let tempEarData = [];     
let tempGazeData = [];
// Variable baru untuk analisis Paham/Tidak Paham
let mistakeCount = 0;     // Jumlah nada salah sebelum ketemu nada benar
let hesitationTime = 0;   // Waktu diam (ragu-ragu) sebelum mulai main
let isChordStarted = false; // Flag penanda user sudah mulai genjreng

// ==========================================
//  ADMIN LOGIC
// ==========================================
const handleAdminLogin = async () => {
  if(!adminEmail.value || !adminPassword.value) { alert("Isi email/password!"); return; }
  isLoggingIn.value = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail.value, password: adminPassword.value });
    if (error) throw error;
    showAdminLogin.value = false; currentStep.value = 'admin';
    adminEmail.value = ''; adminPassword.value = ''; fetchSongsMenu(); 
  } catch (err) { alert("Login Gagal: " + err.message); } 
  finally { isLoggingIn.value = false; }
};
const handleAdminLogout = async () => { await supabase.auth.signOut(); currentStep.value = 'login'; };

const addChordToSequence = () => {
  if (!selectedBaseChord.value) return;
  const baseData = LIBRARY_CHORDS[selectedBaseChord.value];
  const displayName = chordCustomLabel.value ? `${selectedBaseChord.value.split(' ')[0]} (${chordCustomLabel.value})` : selectedBaseChord.value;
  newSongSequence.value.push({ name: displayName, rootFreq: baseData.rootFreq, dots: baseData.dots });
  chordCustomLabel.value = '';
};
const removeLastChord = () => { newSongSequence.value.pop(); };
const prepareEditSong = async (song) => {
  editingSongId.value = song.id; newSongTitle.value = song.title; newSongSlug.value = song.slug;
  try {
    const { data } = await supabase.from('songs').select('chord_sequence').eq('id', song.id).single();
    newSongSequence.value = data.chord_sequence; window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch(err) { alert("Gagal ambil data."); }
};
const cancelEdit = () => { editingSongId.value = null; newSongTitle.value = ''; newSongSlug.value = ''; newSongSequence.value = []; };
const deleteSong = async (songId) => {
  if(!confirm("Hapus lagu ini?")) return;
  await supabase.from('songs').delete().eq('id', songId);
  alert("Terhapus."); fetchSongsMenu();
};
const saveSongToDB = async () => {
  if(!newSongTitle.value || !newSongSequence.value.length) { alert("Data kurang!"); return; }
  const payload = { title: newSongTitle.value, slug: newSongSlug.value.toLowerCase().replace(/\s+/g, '-'), chord_sequence: newSongSequence.value };
  if (editingSongId.value) await supabase.from('songs').update(payload).eq('id', editingSongId.value);
  else await supabase.from('songs').insert([payload]);
  alert("Disimpan!"); cancelEdit(); fetchSongsMenu();
};

// ==========================================
//  USER LOGIC
// ==========================================
const fetchSongsMenu = async () => {
  isLoadingMenu.value = true;
  const { data } = await supabase.from('songs').select('id, title, slug').order('id', { ascending: true });
  availableSongs.value = data || []; isLoadingMenu.value = false;
};
const handleLogin = async () => {
  if (!username.value.trim()) { alert("Isi nama!"); return; }
  isCheckingName.value = true; 
  const { data } = await supabase.from('tracking_logs').select('username').eq('username', username.value).limit(1);
  if (data?.length) {
    if (confirm(`Halo ${username.value}! Masuk Mode Latihan (Tidak Direkam)?`)) isPracticeMode.value = true;
    else isPracticeMode.value = false;
  } else isPracticeMode.value = false;
  currentStep.value = 'intro'; fetchSongsMenu(); isCheckingName.value = false;
};
const selectSongAndStart = async (slug) => {
  const { data } = await supabase.from('songs').select('*').eq('slug', slug).single();
  songChords.value = data.chord_sequence; selectedSongTitle.value = data.title; startSession(); 
};
const goBack = () => { if(audioContext) audioContext.suspend(); currentStep.value = 'intro'; isSessionFinished.value = false; activeChordIndex.value = 0; };

// ==========================================
//  CORE ENGINE (AUDIO & ML DATA)
// ==========================================
const startSession = async () => {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  await audioContext.resume();
  if (!microphone) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; 
      microphone = audioContext.createMediaStreamSource(stream); microphone.connect(analyser);
  }
  currentStep.value = 'belajar'; resetChordMetrics(); analyzeAudioLoop(); 
};

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
  
  if (pitch !== -1) { 
    detectedPitch.value = Math.round(pitch); 
    
    // --- LOGIC DETEKSI KESALAHAN & RAGU (DATA POINT ML) ---
    if (!currentChord.value) return;
    const target = currentChord.value.rootFreq;

    // 1. Deteksi Keragu-raguan (Hesitation)
    // Jika user baru mulai main setelah sekian detik diam
    if (!isChordStarted) {
        isChordStarted = true;
        hesitationTime = Date.now() - chordStartTime;
    }

    // 2. Deteksi Kesalahan (Mistake)
    // Jika nada terdengar (rms > 0.02) TAPI selisih frekuensi jauh (> 50Hz)
    // Berarti user salah kunci
    if (Math.abs(pitch - target) > 50) {
        // Debounce sedikit biar gak spam counter
        if (Math.random() > 0.85) mistakeCount++;
    }

    checkPitchMatch(pitch); 
  } else { 
    detectedPitch.value = 0; isPitchCorrect.value = false; 
  }
  audioAnimationId = requestAnimationFrame(analyzeAudioLoop);
};

const checkPitchMatch = (hz) => {
  if (isSaving.value || isSessionFinished.value) return;
  const target = currentChord.value.rootFreq;
  if (hz > (target - 35) && hz < (target + 35)) handleCorrectChord();
};

const handleCorrectChord = async () => {
  if (isSaving.value) return;
  isPitchCorrect.value = true; isSaving.value = true; 
  await saveToSupabase();
  setTimeout(() => { nextChord(); }, 1200); 
};

const resetChordMetrics = () => {
  chordStartTime = Date.now(); 
  tempEarData = []; tempGazeData = [];
  mistakeCount = 0; hesitationTime = 0; isChordStarted = false; // Reset ML vars
  isPitchCorrect.value = false; isSaving.value = false; detectedPitch.value = 0;
};
const nextChord = () => {
  if (activeChordIndex.value < songChords.value.length - 1) { 
    activeChordIndex.value++; resetChordMetrics(); 
  } else { finishSession(); }
};
const finishSession = () => { isSessionFinished.value = true; status.value = "Sesi Selesai!"; };
const handleRetrySameUser = () => {
  activeChordIndex.value = 0; isPitchCorrect.value = false; isSaving.value = false;
  isSessionFinished.value = false; resetChordMetrics(); 
};

const saveToSupabase = async () => {
  if (isPracticeMode.value) return; 
  const endTime = Date.now(); 
  const avgEar = tempEarData.length ? (tempEarData.reduce((a,b)=>a+b,0)/tempEarData.length) : 0;
  const avgGaze = tempGazeData.length ? (tempGazeData.reduce((a,b)=>a+b,0)/tempGazeData.length) : 0;
  
  await supabase.from('tracking_logs').insert([{
    username: username.value, level: userLevel.value, chord_target: currentChord.value.name,
    duration_ms: endTime - chordStartTime, // Lama penyelesaian
    avg_ear: parseFloat(avgEar.toFixed(3)), // Fokus mata
    avg_gaze: parseFloat(avgGaze.toFixed(3)), // Lirikan
    mistake_count: mistakeCount, // Jumlah salah nada
    hesitation_ms: hesitationTime, // Waktu mikir
    created_at: new Date().toISOString()
  }]);
};

// --- VISUALISASI ---
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
        if(!isSaving.value && !isSessionFinished.value && landmarks[468]) { 
           tempEarData.push(calculateEAR(landmarks)); 
           tempGazeData.push(calculateGaze(landmarks)); 
        }
        if (drawConnectors && FACEMESH_TESSELATION) drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {color: '#00FF00', lineWidth: 1});
        if (landmarks[468] && landmarks[473]) {
            const leftIris = landmarks[468]; const rightIris = landmarks[473];
            ctx.fillStyle = "#FF0000"; 
            ctx.beginPath(); ctx.arc(leftIris.x * canvas.width, leftIris.y * canvas.height, 5, 0, 2*Math.PI); ctx.fill();
            ctx.beginPath(); ctx.arc(rightIris.x * canvas.width, rightIris.y * canvas.height, 5, 0, 2*Math.PI); ctx.fill();
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
      <div style="margin-top: 20px; font-size: 0.8rem; cursor: pointer; color: #8D6E63;" @click="showAdminLogin = true">🔐 Admin Login</div>
    </div>

    <div v-if="showAdminLogin" class="overlay-finished fade-in">
      <div class="wood-panel" style="width: 300px;">
        <h2>Admin Login</h2>
        <div class="input-group"><label>Email</label><input v-model="adminEmail" class="input-cozy" type="email" /></div>
        <div class="input-group"><label>Password</label><input v-model="adminPassword" class="input-cozy" type="password" /></div>
        <div style="display:flex; gap:10px;">
          <button @click="showAdminLogin = false" class="btn-coffee" style="background:#555">Batal</button>
          <button @click="handleAdminLogin" class="btn-leaf">{{ isLoggingIn ? '...' : 'Masuk' }}</button>
        </div>
      </div>
    </div>

    <div v-else-if="currentStep === 'admin'" class="card wood-panel fade-in" style="max-width: 700px; width: 95%;">
      <h2>🛠️ Manajemen Lagu</h2>
      <div class="admin-section" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; margin-bottom: 20px;">
        <h3 style="margin-top:0; color:#FFCC80">{{ editingSongId ? '✏️ Edit Lagu' : '➕ Tambah Lagu Baru' }}</h3>
        <div class="input-group"><label>Judul</label><input v-model="newSongTitle" class="input-cozy" /></div>
        <div class="input-group"><label>Slug</label><input v-model="newSongSlug" class="input-cozy" /></div>
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 5px; margin: 10px 0;">
          <label style="color:#FFF"><b>Susun Chord:</b></label>
          <div style="display: flex; gap: 5px; margin-top: 5px;">
            <select v-model="selectedBaseChord" class="input-cozy" style="flex:1"><option v-for="(val, key) in LIBRARY_CHORDS" :key="key" :value="key">{{ key }}</option></select>
            <input v-model="chordCustomLabel" class="input-cozy" placeholder="Lirik.." style="flex:1" />
            <button @click="addChordToSequence" class="btn-leaf" style="width: auto; padding: 0 15px;">+</button>
          </div>
        </div>
        <div style="margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 5px;">
          <span v-for="(c, i) in newSongSequence" :key="i" style="background: #D84315; padding: 2px 8px; border-radius: 5px; font-size: 0.8rem;">{{ c.name }}</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button v-if="newSongSequence.length > 0" @click="removeLastChord" class="btn-coffee" style="background: #555; font-size: 0.8rem;">Hapus Terakhir</button>
          <button @click="saveSongToDB" class="btn-leaf">{{ editingSongId ? 'Update' : 'Simpan' }}</button>
          <button v-if="editingSongId" @click="cancelEdit" class="btn-coffee" style="background: #777;">Batal</button>
        </div>
      </div>
      <h3 style="color:#FFCC80; text-align:left; border-bottom:1px solid #555;">📂 Daftar Lagu</h3>
      <div style="max-height: 200px; overflow-y: auto; text-align: left;">
        <div v-for="song in availableSongs" :key="song.id" style="display:flex; justify-content:space-between; background:rgba(255,255,255,0.05); padding:8px; margin-bottom:5px; border-radius:5px;">
          <span>🎵 {{ song.title }}</span>
          <div>
            <button @click="prepareEditSong(song)" style="background:#FFA726; border:none; border-radius:5px; padding:5px 10px; margin-right:5px; cursor:pointer;">Edit</button>
            <button @click="deleteSong(song.id)" style="background:#EF5350; border:none; border-radius:5px; padding:5px 10px; cursor:pointer; color:white;">Hapus</button>
          </div>
        </div>
      </div>
      <button @click="handleAdminLogout" style="margin-top:20px; background:none; border:none; color: #aaa; cursor:pointer;">Keluar Admin</button>
    </div>

    <div v-else-if="currentStep === 'intro'" class="card wood-panel fade-in">
      <h2>Halo, {{ username }}!</h2>
      <div class="note-paper"><p>Pilih materi latihan:</p></div>
      <div class="song-menu" style="display: flex; gap: 10px; flex-direction: column;">
        <button v-for="song in availableSongs" :key="song.id" @click="selectSongAndStart(song.slug)" class="btn-leaf">🎵 {{ song.title }}</button>
        <div v-if="availableSongs.length === 0" style="color:#aaa;">Belum ada lagu. Hubungi Admin.</div>
      </div>
      <button @click="currentStep = 'login'" class="btn-coffee" style="margin-top: 15px;">Keluar</button>
    </div>

    <div v-show="currentStep === 'belajar'" class="room-container fade-in">
      <div class="top-shelf">
        <button @click="goBack" class="btn-small-back">⬅ Kembali</button>
        <div class="status-badge" :class="isWajahTerdeteksi ? 'status-ok' : 'status-warn'"><span class="dot"></span> {{ isWajahTerdeteksi ? 'Wajah OK' : 'Cari Wajah...' }}</div>
        <div class="freq-badge" :style="{ background: detectedPitch > 0 ? '#D84315' : 'rgba(0,0,0,0.4)' }">{{ detectedPitch > 0 ? '🌊 ' + detectedPitch + ' Hz' : '🔇 MENUNGGU...' }}</div>
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
              <line x1="10" y1="18" x2="10" y2="140" stroke="#8D6E63" stroke-width="2"/><line x1="43" y1="18" x2="43" y2="140" stroke="#8D6E63" stroke-width="2"/><line x1="76" y1="18" x2="76" y2="140" stroke="#8D6E63" stroke-width="2"/><line x1="110" y1="18" x2="110" y2="140" stroke="#8D6E63" stroke-width="2"/>
              <line x1="10" y1="50" x2="110" y2="50" stroke="#A1887F" stroke-width="2"/><line x1="10" y1="90" x2="110" y2="90" stroke="#A1887F" stroke-width="2"/><line x1="10" y1="130" x2="110" y2="130" stroke="#A1887F" stroke-width="2"/>
              <circle v-for="(dot, i) in currentChord?.dots || []" :key="i" :cx="dot.s === 4 ? 10 : dot.s === 3 ? 43 : dot.s === 2 ? 76 : 110" :cy="dot.f === 1 ? 35 : dot.f === 2 ? 70 : dot.f === 3 ? 110 : 140" r="10" fill="#D84315" stroke="#fff" stroke-width="2" />
            </svg>
          </div>
          <div class="chord-info">
            <span class="label-chord" style="color: #FF7043; font-weight: bold;">{{ selectedSongTitle }}</span>
            <h1 class="title-chord">{{ currentChord ? currentChord.name : 'Loading...' }}</h1>
            <p class="hz-info">Target: ±{{ currentChord ? currentChord.rootFreq : 0 }} Hz</p>
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
.btn-small-back { background: rgba(0,0,0,0.5); border: 1px solid #aaa; color: white; padding: 5px 10px; border-radius: 10px; cursor: pointer; font-size: 0.8rem; margin-right: 10px; }
.btn-small-back:hover { background: #555; }
</style>