/**
 * Kisses App - Damian Skotzke Style Micro-interaction Engine
 * Complete interactive logic, Web Audio synthesizer, and particle physics.
 */

// ==========================================
// 1. State Management
// ==========================================
const STORAGE_KEY = 'kisses_app_data_v1';

const defaultState = {
  receivedCount: 200,
  sentCount: 92,
  sinceTime: '6am',
  partnerName: 'My Love',
  soundEnabled: true,
  hapticEnabled: true,
  mode: 'desktop', // 'desktop' or 'widget'
  widgetOpen: true,
  liveVideo: false,
  roomId: null,
  role: null, // 'a' (created the room) or 'b' (joined via invite link)
  clientId: null // stable per-device id, so reconnects don't look like a 3rd person
};

let state = { ...defaultState };

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      state = { ...defaultState, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load state from localStorage', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save state to localStorage', e);
  }
}

// ==========================================
// 2. Web Audio Sound Synthesizer
// ==========================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// Synthesize a cute, crisp "kiss" & gentle chime pop
function playKissSound(pitchMultiplier = 1.0) {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 1. Subtle "mwah" airy kiss envelope
  const kissOsc = ctx.createOscillator();
  const kissGain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  kissOsc.type = 'sine';
  kissOsc.frequency.setValueAtTime(320 * pitchMultiplier, now);
  kissOsc.frequency.exponentialRampToValueAtTime(740 * pitchMultiplier, now + 0.07);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800 * pitchMultiplier, now);
  filter.Q.setValueAtTime(3.0, now);

  kissGain.gain.setValueAtTime(0.001, now);
  kissGain.gain.linearRampToValueAtTime(0.28, now + 0.02);
  kissGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

  kissOsc.connect(filter);
  filter.connect(kissGain);
  kissGain.connect(ctx.destination);

  kissOsc.start(now);
  kissOsc.stop(now + 0.12);

  // 2. Sweet crystalline chime harmonic
  const chimeOsc = ctx.createOscillator();
  const chimeGain = ctx.createGain();

  chimeOsc.type = 'triangle';
  chimeOsc.frequency.setValueAtTime(980 * pitchMultiplier, now + 0.03);
  chimeOsc.frequency.exponentialRampToValueAtTime(1320 * pitchMultiplier, now + 0.16);

  chimeGain.gain.setValueAtTime(0.001, now + 0.03);
  chimeGain.gain.linearRampToValueAtTime(0.18, now + 0.05);
  chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

  chimeOsc.connect(chimeGain);
  chimeGain.connect(ctx.destination);

  chimeOsc.start(now + 0.03);
  chimeOsc.stop(now + 0.36);
}

// Incoming kiss sound (sweeter, lower romantic chime)
function playReceiveSound() {
  if (!state.soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const freqs = [523.25, 659.25, 783.99, 1046.50]; // C - E - G - C arpeggio

  freqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const startTime = now + idx * 0.06;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.45);
  });
}

// Trigger haptic vibration on mobile devices
function triggerHaptic(duration = 18) {
  if (state.hapticEnabled && 'vibrate' in navigator) {
    try {
      navigator.vibrate(duration);
    } catch (e) {}
  }
}

// ==========================================
// 3. Realtime Partner Sync (Cloudflare Worker + Durable Object)
// ==========================================
const SYNC_HOST = 'kisses-app-sync.bachvinhtran.workers.dev';

function genRoomId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

// Assign this device a room from the invite link, or create a fresh one
function initRoom() {
  if (!state.clientId) {
    state.clientId = crypto.randomUUID();
    saveState();
  }

  const params = new URLSearchParams(window.location.search);
  const roomFromLink = params.get('room');

  if (roomFromLink) {
    state.roomId = roomFromLink;
    state.role = 'b';
    saveState();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (!state.roomId) {
    state.roomId = genRoomId();
    state.role = 'a';
    saveState();
  }
}

function getInviteLink() {
  return `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
}

let syncSocket = null;
let syncRetryDelay = 1000;
let syncBlocked = false;
let lastFromA = null;
let lastFromB = null;
let partnerWasOnline = false;

function connectSync() {
  if (!state.roomId || syncBlocked) return;

  const params = `role=${state.role}&clientId=${state.clientId}`;
  syncSocket = new WebSocket(`wss://${SYNC_HOST}/room/${state.roomId}?${params}`);

  syncSocket.addEventListener('open', () => {
    syncRetryDelay = 1000;
  });

  syncSocket.addEventListener('message', (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (msg.type === 'state') {
      applyServerState(msg.kissesFromA, msg.kissesFromB);
      applyPeerInfo(msg);
    } else if (msg.type === 'peers') {
      applyPeerInfo(msg);
    } else if (msg.type === 'rejected') {
      handleSyncRejected(msg.reason);
    }
  });

  syncSocket.addEventListener('close', (evt) => {
    syncSocket = null;
    // Code 4000 = another tab/device of ours took over this seat; 4001 = a
    // 3rd distinct visitor was turned away. Neither should keep retrying.
    if (syncBlocked || evt.code === 4000 || evt.code === 4001) return;
    setTimeout(connectSync, syncRetryDelay);
    syncRetryDelay = Math.min(syncRetryDelay * 1.6, 15000);
  });

  syncSocket.addEventListener('error', () => {
    syncSocket?.close();
  });
}

function handleSyncRejected(reason) {
  syncBlocked = true;
  if (reason === 'room-full') {
    showToast('Phòng này đã đủ 2 người rồi 💔');
  }
}

function sendSync(msg) {
  if (syncSocket && syncSocket.readyState === WebSocket.OPEN) {
    syncSocket.send(JSON.stringify(msg));
  }
}

function applyServerState(kissesFromA, kissesFromB) {
  const isFirstSnapshot = lastFromA === null;
  const prevReceived = state.role === 'a' ? lastFromB : lastFromA;
  const newReceived = state.role === 'a' ? kissesFromB : kissesFromA;
  const newSent = state.role === 'a' ? kissesFromA : kissesFromB;

  state.sentCount = newSent;
  state.receivedCount = newReceived;
  saveState();
  updateUI();

  if (!isFirstSnapshot && newReceived > prevReceived) {
    celebrateReceivedKiss(false);
  }

  lastFromA = kissesFromA;
  lastFromB = kissesFromB;
}

function applyPeerInfo({ aOnline, bOnline }) {
  const partnerOnline = state.role === 'a' ? bOnline : aOnline;
  if (partnerOnline && !partnerWasOnline) {
    showToast(`${state.partnerName} đã kết nối 💞`);
  } else if (!partnerOnline && partnerWasOnline) {
    showToast(`${state.partnerName} tạm ngoại tuyến`);
  }
  partnerWasOnline = partnerOnline;
}

// ==========================================
// 4. Multi-Heart Eruption Particle Engine
// ==========================================
const container = document.getElementById('heartsBurst');

function spawnKissEruption(originX, originY) {
  // Erupt between 8 to 14 hearts
  const heartCount = 10 + Math.floor(Math.random() * 5);
  
  for (let i = 0; i < heartCount; i++) {
    createFloatingHeart(originX, originY, i);
  }
}

function createFloatingHeart(originX, originY, index) {
  const heartEl = document.createElement('div');
  heartEl.className = 'floating-heart';

  const size = 38 + Math.random() * 44; // 38px to 82px
  const startX = originX + (Math.random() - 0.5) * 80;
  const startY = originY - 10 + (Math.random() - 0.5) * 20;

  // Trajectory offsets
  const txMid = (Math.random() - 0.5) * 40;
  const tyMid = -(70 + Math.random() * 60);

  const txEnd = (Math.random() - 0.5) * 110;
  const tyEnd = -(220 + Math.random() * 200); // float up 220px to 420px

  const rStart = (Math.random() - 0.5) * 35;
  const rMid = (Math.random() - 0.5) * 45;
  const rEnd = (Math.random() - 0.5) * 75;

  const sPeak = 0.85 + Math.random() * 0.35;
  const sEnd = sPeak * (0.8 + Math.random() * 0.2);

  const duration = 1.0 + Math.random() * 0.6; // 1.0s to 1.6s
  const delay = index * 0.035 + Math.random() * 0.05; // seconds

  heartEl.style.width = `${size}px`;
  heartEl.style.height = `${size}px`;
  heartEl.style.left = `${startX - size / 2}px`;
  heartEl.style.top = `${startY - size / 2}px`;

  heartEl.style.setProperty('--tx-start', '0px');
  heartEl.style.setProperty('--ty-start', '0px');
  heartEl.style.setProperty('--tx-mid', `${txMid}px`);
  heartEl.style.setProperty('--ty-mid', `${tyMid}px`);
  heartEl.style.setProperty('--tx-end', `${txEnd}px`);
  heartEl.style.setProperty('--ty-end', `${tyEnd}px`);

  heartEl.style.setProperty('--r-start', `${rStart}deg`);
  heartEl.style.setProperty('--r-mid', `${rMid}deg`);
  heartEl.style.setProperty('--r-end', `${rEnd}deg`);

  heartEl.style.setProperty('--s-peak', `${sPeak}`);
  heartEl.style.setProperty('--s-end', `${sEnd}`);
  heartEl.style.setProperty('--dur', `${duration}s`);
  heartEl.style.animationDelay = `${delay}s`;

  const img = document.createElement('img');
  img.src = 'assets/heart_3d.png';
  img.alt = 'Kiss Heart';
  heartEl.appendChild(img);

  container.appendChild(heartEl);

  setTimeout(() => {
    heartEl.remove();
  }, (duration + delay) * 1000 + 200);
}

// ==========================================
// 5. UI Rendering & Interactions
// ==========================================
const kissNumberEl = document.getElementById('kissNumber');
const kissLabelEl = document.getElementById('kissLabel');
const kissStatusEl = document.getElementById('kissStatus');
const menuPillCountEl = document.getElementById('menuPillCount');
const menuPillEl = document.getElementById('menuPill');
const widgetAnchor = document.getElementById('widgetAnchor');
const heroHeart = document.getElementById('heroHeart');
const btnKiss = document.getElementById('btnKiss');
const btnSync = document.getElementById('btnSync');
const btnClose = document.getElementById('btnClose');
const btnSettings = document.getElementById('btnSettings');
const desktopViewport = document.getElementById('desktopViewport');
const menubarClock = document.getElementById('menubarClock');
const toastNotice = document.getElementById('toastNotice');
const toastText = document.getElementById('toastText');

// Dock Elements
const dockToggleMode = document.getElementById('dockToggleMode');
const dockModeIcon = document.getElementById('dockModeIcon');
const dockModeText = document.getElementById('dockModeText');
const dockReceiveKiss = document.getElementById('dockReceiveKiss');
const dockToggleLive = document.getElementById('dockToggleLive');
const dockToggleSound = document.getElementById('dockToggleSound');
const dockSoundIcon = document.getElementById('dockSoundIcon');
const wallpaperVideo = document.getElementById('wallpaperVideo');

// Modal Elements
const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const inputPartnerName = document.getElementById('inputPartnerName');
const inputSinceTime = document.getElementById('inputSinceTime');
const toggleSoundSwitch = document.getElementById('toggleSoundSwitch');
const toggleHapticSwitch = document.getElementById('toggleHapticSwitch');
const btnResetCounters = document.getElementById('btnResetCounters');

function updateUI() {
  kissNumberEl.textContent = state.receivedCount;
  menuPillCountEl.textContent = state.receivedCount;
  kissLabelEl.textContent = 'For you';
  kissStatusEl.textContent = `Since ${state.sinceTime} · ${state.sentCount} sent`;

  // Menu bar pill state
  if (state.widgetOpen) {
    widgetAnchor.classList.remove('hidden');
    menuPillEl.classList.add('active');
  } else {
    widgetAnchor.classList.add('hidden');
    menuPillEl.classList.remove('active');
  }

  // Viewport mode
  if (state.mode === 'widget') {
    desktopViewport.classList.add('mode-widget');
    dockModeIcon.textContent = '🖥️';
    dockModeText.textContent = 'Desktop Mode';
  } else {
    desktopViewport.classList.remove('mode-widget');
    dockModeIcon.textContent = '📱';
    dockModeText.textContent = 'Mobile Mode';
  }

  // Live video
  if (state.liveVideo) {
    wallpaperVideo.classList.add('active');
    wallpaperVideo.play().catch(() => {});
    dockToggleLive.classList.add('active');
  } else {
    wallpaperVideo.classList.remove('active');
    wallpaperVideo.pause();
    dockToggleLive.classList.remove('active');
  }

  // Sound dock icon
  dockSoundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
  if (toggleSoundSwitch) {
    toggleSoundSwitch.classList.toggle('on', state.soundEnabled);
  }
  if (toggleHapticSwitch) {
    toggleHapticSwitch.classList.toggle('on', state.hapticEnabled);
  }
}

// Show gentle toast notice
let toastTimer = null;
function showToast(msg) {
  if (toastTimer) clearTimeout(toastTimer);
  toastText.textContent = msg;
  toastNotice.classList.add('show');
  toastTimer = setTimeout(() => {
    toastNotice.classList.remove('show');
  }, 2400);
}

// Kiss button click handler
let kissStreak = 0;
let streakTimer = null;

function handleKiss(e) {
  // Sound & Haptics
  kissStreak++;
  if (streakTimer) clearTimeout(streakTimer);
  streakTimer = setTimeout(() => { kissStreak = 0; }, 800);

  // Slightly elevate pitch on rapid clicks for playful delight!
  const pitch = 1.0 + Math.min(kissStreak * 0.05, 0.4);
  playKissSound(pitch);
  triggerHaptic(18);

  // Increment sent kisses (optimistic; server snapshot reconciles it)
  state.sentCount++;
  saveState();
  updateUI();
  sendSync({ type: 'kiss' });

  // Button Ripple Effect
  const rect = btnKiss.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.max(rect.width, rect.height);
  const clickX = e ? (e.clientX - rect.left) : (rect.width / 2);
  const clickY = e ? (e.clientY - rect.top) : (rect.height / 2);
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${clickX - size / 2}px`;
  ripple.style.top = `${clickY - size / 2}px`;
  btnKiss.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

  // Hero Heart Squish
  heroHeart.classList.remove('squish');
  void heroHeart.offsetWidth; // reflow
  heroHeart.classList.add('squish');

  // Spawn Eruption of 3D floating hearts
  const cardRect = document.getElementById('kissesCard').getBoundingClientRect();
  const originX = rect.left - cardRect.left + (rect.width / 2);
  const originY = rect.top - cardRect.top + (rect.height / 2);
  spawnKissEruption(originX, originY);
}

btnKiss.addEventListener('click', handleKiss);

// Hero Heart click also triggers a kiss
heroHeart.addEventListener('click', (e) => {
  handleKiss(e);
});

// Shared "kiss received" effect: sound, haptics, animation, toast.
// isDemo=true previews the effect without touching any counter (used
// when there's no real partner connected yet, so nothing gets out of
// sync with the server's authoritative count).
function celebrateReceivedKiss(isDemo) {
  playReceiveSound();
  triggerHaptic(35);

  kissNumberEl.classList.remove('bump');
  void kissNumberEl.offsetWidth;
  kissNumberEl.classList.add('bump');

  heroHeart.classList.remove('squish');
  void heroHeart.offsetWidth;
  heroHeart.classList.add('squish');

  const cardRect = document.getElementById('kissesCard').getBoundingClientRect();
  const heroRect = heroHeart.getBoundingClientRect();
  const originX = heroRect.left - cardRect.left + (heroRect.width / 2);
  const originY = heroRect.top - cardRect.top + (heroRect.height / 2);
  spawnKissEruption(originX, originY + 40);

  showToast(isDemo
    ? 'Xem trước hiệu ứng nhận kiss ✨ (chưa mời partner nên chưa tính số đếm)'
    : `Kiss received from ${state.partnerName}! 💖`);
}

// Legacy local-only simulate, kept as a fallback demo for whenever
// there's no live partner connection (offline, or not paired yet).
function handleReceiveKiss() {
  state.receivedCount++;
  saveState();
  updateUI();
  celebrateReceivedKiss(false);
}

dockReceiveKiss.addEventListener('click', () => {
  if (syncSocket && syncSocket.readyState === WebSocket.OPEN && partnerWasOnline) {
    celebrateReceivedKiss(true);
  } else {
    handleReceiveKiss();
  }
});

// Sync button = invite partner via shareable link
btnSync.addEventListener('click', async () => {
  const link = getInviteLink();
  btnSync.classList.add('spinning');
  playKissSound(1.2);

  try {
    if (navigator.share) {
      await navigator.share({ title: 'Kisses', text: 'Ghép đôi Kisses với mình nhé 💋', url: link });
      showToast('Đã gửi lời mời ghép đôi 💌');
    } else {
      await navigator.clipboard.writeText(link);
      showToast('Đã copy link mời — gửi cho partner để ghép đôi 💌');
    }
  } catch (e) {
    try {
      window.prompt('Copy link mời partner:', link);
    } catch (e2) {
      showToast('Không tự copy được — link mời: ' + link);
    }
  } finally {
    setTimeout(() => btnSync.classList.remove('spinning'), 400);
  }
});

// Close button
btnClose.addEventListener('click', () => {
  state.widgetOpen = false;
  saveState();
  updateUI();
});

// Menubar pill toggle
menuPillEl.addEventListener('click', () => {
  state.widgetOpen = !state.widgetOpen;
  saveState();
  updateUI();
});

// Dock Mode Toggle (Desktop / Mobile)
dockToggleMode.addEventListener('click', () => {
  state.mode = (state.mode === 'desktop') ? 'widget' : 'desktop';
  if (state.mode === 'widget') {
    state.widgetOpen = true; // Always visible in widget mode
  }
  saveState();
  updateUI();
});

// Live Video Background Toggle
dockToggleLive.addEventListener('click', () => {
  state.liveVideo = !state.liveVideo;
  saveState();
  updateUI();
});

// Sound Toggle
dockToggleSound.addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  saveState();
  updateUI();
  showToast(state.soundEnabled ? 'Sound Enabled 🔊' : 'Sound Muted 🔇');
});

// Settings Modal
btnSettings.addEventListener('click', () => {
  inputPartnerName.value = state.partnerName;
  inputSinceTime.value = state.sinceTime;
  settingsModal.classList.add('open');
});

btnCloseSettings.addEventListener('click', () => {
  state.partnerName = inputPartnerName.value.trim() || 'My Love';
  state.sinceTime = inputSinceTime.value.trim() || '6am';
  saveState();
  updateUI();
  settingsModal.classList.remove('open');
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    btnCloseSettings.click();
  }
});

toggleSoundSwitch.addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  saveState();
  updateUI();
});

toggleHapticSwitch.addEventListener('click', () => {
  state.hapticEnabled = !state.hapticEnabled;
  saveState();
  updateUI();
});

btnResetCounters.addEventListener('click', () => {
  if (confirm('Reset sent and received counters to 0?')) {
    state.receivedCount = 0;
    state.sentCount = 0;
    saveState();
    updateUI();
    sendSync({ type: 'reset' });
    showToast('Counters reset! 🔄');
    settingsModal.classList.remove('open');
  }
});

// Live Clock for macOS menubar
function updateClock() {
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[now.getDay()];
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  menubarClock.textContent = `${day} ${hours}:${minutes} ${ampm}`;
}

setInterval(updateClock, 1000);
updateClock();

// Initial load
loadState();
initRoom();
updateUI();
connectSync();
console.log('Kisses App initialized successfully!');

// Auto-kiss test trigger for visual verification
if (window.location.search.includes('autokiss')) {
  setTimeout(() => { handleKiss(); }, 50);
  setTimeout(() => { handleKiss(); }, 150);
  setTimeout(() => { handleKiss(); }, 250);
}
