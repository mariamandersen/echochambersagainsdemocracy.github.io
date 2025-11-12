// --- API base (same-origin on deployed site) ---
const API_BASE = (() => {
  return "";
})();

// --- DOM ---
const chatEl      = document.getElementById("chat");
const inputEl     = document.getElementById("input");
const sendBtn     = document.getElementById("send");
const sliderEl    = document.getElementById("transparency");
const presetEl    = document.getElementById("voicePreset");
const previewBtn  = document.getElementById("previewVoice");

// ---- Session id for anonym logging ----
const SID_KEY = "tc_session_id";
let sessionId = localStorage.getItem(SID_KEY);
if (!sessionId) {
  sessionId = crypto.getRandomValues(new Uint32Array(4)).join("-");
  localStorage.setItem(SID_KEY, sessionId);
}

// Map local audio files to presets
const LOCAL_VOICES = {
  creepy: "sfx/creepy.mp3",
  yelling: "sfx/yelling.mp3"
};

// ---- Logging helper ----
async function logEvent(event, payload = {}) {
  try {
    await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, event, ...payload })
    });
  } catch {
    // never break UI on logging fail
  }
}

// ----- Bias UI (solid color background via CSS var) -----
function updateBiasUI(v) {
  const hue = Math.round((v / 100) * 120); // 0 red -> 120 green
  document.documentElement.style.setProperty('--bias-hue', hue);
  const lbl = document.getElementById('toneLabel');
  if (lbl) {
    lbl.textContent = (v < 33) ? 'Manipulative'
                     : (v < 66) ? 'Subtle'
                     : 'Radically transparent';
  }
}

// init bias UI
updateBiasUI(Number(sliderEl?.value || 50));

// debounce log on slider, and update ambient volume (below)
let logTimer = null;
sliderEl?.addEventListener("input", () => {
  const t = Number(sliderEl.value);
  updateBiasUI(t);
  setAmbientGain(ambientGainForTransparency(t));
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => logEvent("slider_change", { transparency: t }), 150);
});

// ---- Chat UI helpers ----
function addBubble(text, who = "ai") {
  const div = document.createElement("div");
  div.className = "bubble " + (who === "me" ? "me" : "ai");
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ---------------- TTS: Voices & Presets ----------------

/**
 * Persona presets = (voice match hints) + (prosody style).
 * nameLike/lang are soft hints; fall back gracefully.
 */
const VOICE_PRESETS = {
  transparent: { nameLike: /(Samantha|Serena|Google US English)/i, lang: /en/i, rate: 0.98, pitch: 1.05, volume: 1.0 },
  anchor:      { nameLike: /(Daniel|Alex|Google UK English Male|US English)/i, lang: /en/i, rate: 1.00, pitch: 0.95, volume: 1.0 },
  influencer:  { nameLike: /(Ava|Victoria|Google US English Female|Karen)/i,   lang: /en/i, rate: 1.12, pitch: 1.15, volume: 1.0 },
  coach:       { nameLike: /(Alex|Daniel|Michael|Google US English)/i,         lang: /en/i, rate: 1.05, pitch: 1.00, volume: 1.0 },
  bureaucrat:  { nameLike: /(Fred|Google UK English Male|Moira|Tessa)/i,       lang: /en/i, rate: 0.88, pitch: 0.85, volume: 1.0 },
  robot:       { nameLike: /(Google English|UK English)/i,                     lang: /en/i, rate: 0.95, pitch: 0.80, volume: 1.0 },
  whispery:    { nameLike: /(Ava|Serena|Google US English Female)/i,           lang: /en/i, rate: 0.90, pitch: 1.20, volume: 0.6 }, // soft feel
  creepy:      { nameLike: /(Google US English|UK English|Daniel|Alex)/i,      lang: /en/i, rate: 0.92, pitch: 0.78, volume: 0.9 }
};

// Robust voice list
let ALL_VOICES = [];
function refreshVoices() { ALL_VOICES = speechSynthesis.getVoices() || []; }
speechSynthesis.onvoiceschanged = refreshVoices;
setTimeout(refreshVoices, 100);

// Choose a voice for a given preset
function findVoiceForPreset(presetKey) {
  const hints = VOICE_PRESETS[presetKey] || VOICE_PRESETS.transparent;
  const v = ALL_VOICES;

  const byName = v.find(voice => hints.nameLike?.test(voice.name));
  if (byName) return byName;

  const byLang = v.find(voice => hints.lang?.test(voice.lang));
  if (byLang) return byLang;

  const anyEn  = v.find(voice => /en/i.test(voice.lang));
  if (anyEn) return anyEn;

  return v[0] || null;
}

/** Slightly blend prosody with transparency (more manipulative -> lower pitch & slightly faster). */
function prosodyFor(presetKey, transparency) {
  const base = { ...(VOICE_PRESETS[presetKey] || VOICE_PRESETS.transparent) };
  const t = Math.max(0, Math.min(100, Number(transparency) || 50));
  const manipFactor = (100 - t) / 100; // 1 at 0 (manip), 0 at 100 (transparent)
  return {
    rate:   +(base.rate   + (manipFactor * 0.06)).toFixed(2),
    pitch:  +(base.pitch  - (manipFactor * 0.10)).toFixed(2),
    volume: +(base.volume ?? 1.0)
  };
}

// Persist current preset
const PRESET_KEY = "tc_voice_preset";
let currentPreset = localStorage.getItem(PRESET_KEY) || "transparent";
if (presetEl) presetEl.value = currentPreset;

// Log & store when changed
presetEl?.addEventListener("change", () => {
  currentPreset = presetEl.value;
  localStorage.setItem(PRESET_KEY, currentPreset);
  logEvent("voice_change", { preset: currentPreset });
  maybeStartAmbient(); // update ambient loop when preset changes
});

// --- Preview button plays local horror sounds too ---
previewBtn?.addEventListener("click", () => {
  const t = Number(sliderEl?.value || 50);
  if (LOCAL_VOICES[currentPreset]) {
    const audio = new Audio(LOCAL_VOICES[currentPreset]);
    audio.play().catch(err => console.warn("Preview play failed:", err));
    return;
  }

  const text = {
    transparent: "I will state my assumptions and limits clearly.",
    anchor: "Good evening. Here are the facts as they stand.",
    influencer: "Okayyy, here’s the tea — let’s keep it super simple!",
    coach: "You’ve got this. Let’s take it one step at a time.",
    bureaucrat: "According to subsection twelve, paragraph five, that is not applicable.",
    robot: "Beep. Boop. This response is delivered efficiently.",
    whispery: "I’ll keep it quiet and gentle, so we can think together."
  }[currentPreset] || "This is a voice preview.";

  speak(text, t);
});

// Core TTS helper
// Updated speak() — plays local audio for creepy/yelling
function speak(text, transparency) {
  const file = LOCAL_VOICES[currentPreset];
  if (file) {
    // Play the matching mp3 from /web/sfx/
    const audio = new Audio(file);
    audio.volume = Math.max(0.2, transparency / 100); // a bit louder with more transparency
    audio.play().catch(err => console.warn("Audio play failed:", err));
    return;
  }

  // Otherwise use normal browser TTS
  const voice = findVoiceForPreset(currentPreset);
  const style = prosodyFor(currentPreset, transparency);
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = style.rate;
  u.pitch = style.pitch;
  u.volume = style.volume;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
// -------- Soundscape manager (ambient + stinger) --------
// Place audio files under /web/sfx/ :
//   - sfx/creepy_ambience.mp3   (low drone)
//   - sfx/neutral_ambience.mp3  (very subtle room tone)
//   - sfx/creak_stinger.mp3     (quiet scrape)

let audioCtx;
let ambientSource = null;
let ambientGain = null;
let currentAmbientUrl = null;

async function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume();
}

async function playAmbient(url, gainValue = 0.15) {
  try {
    if (!url) { stopAmbient(); return; }
    await ensureAudio();
    if (currentAmbientUrl === url && ambientSource) return; // already playing

    stopAmbient();

    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(arr);

    ambientSource = audioCtx.createBufferSource();
    ambientSource.buffer = buf;
    ambientSource.loop = true;

    ambientGain = audioCtx.createGain();
    ambientGain.gain.value = gainValue;

    ambientSource.connect(ambientGain).connect(audioCtx.destination);
    ambientSource.start(0);
    currentAmbientUrl = url;
  } catch (e) {
    console.warn("Ambient failed:", e);
  }
}

function stopAmbient() {
  try { if (ambientSource) ambientSource.stop(); } catch {}
  ambientSource = null;
  ambientGain = null;
  currentAmbientUrl = null;
}

function setAmbientGain(g) {
  if (ambientGain) ambientGain.gain.value = Math.max(0, Math.min(1, g));
}

async function playStinger(url, vol = 0.25) {
  try {
    await ensureAudio();
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(arr);
    const src = audioCtx.createBufferSource();
    const g = audioCtx.createGain();
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(g).connect(audioCtx.destination);
    src.start(0);
  } catch (e) {
    console.warn("Stinger failed:", e);
  }
}

// Map presets to ambient loops
function ambientForPreset(presetKey) {
  switch (presetKey) {
    case "creepy":     return "sfx/creepy_ambience.mp3";
    case "bureaucrat": return "sfx/neutral_ambience.mp3";
    case "robot":      return "sfx/neutral_ambience.mp3";
    default:           return ""; // no ambient
  }
}

// transparency -> louder ambient when manipulative (0) and silent when transparent (100)
function ambientGainForTransparency(t) {
  // 0..100 -> 0.25..0.00 (fade out with honesty)
  return +(0.25 * (1 - (t / 100))).toFixed(2);
}

function maybeStartAmbient() {
  const url = ambientForPreset(currentPreset);
  const t = Number(sliderEl?.value || 50);
  if (!url) { stopAmbient(); return; }
  playAmbient(url, ambientGainForTransparency(t));
}

// prime audio after first user gesture (required by browsers)
window.addEventListener("pointerdown", () => maybeStartAmbient(), { once: true });

// ---------------- Chat ----------------
async function send() {
  const msg = inputEl.value.trim();
  if (!msg) return;

  const transparency = Number(sliderEl.value);
  logEvent("question_submitted", { transparency, message_len: msg.length, preset: currentPreset });

  addBubble(msg, "me");
  inputEl.value = "";
  sendBtn.disabled = true;

  const pending = document.createElement("div");
  pending.className = "bubble ai";
  pending.textContent = "…thinking";
  chatEl.appendChild(pending);

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        transparency,
        session_id: sessionId
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`);
    }

    const data = await res.json();
    const reply = data.reply || "(empty reply)";

    pending.remove();
    addBubble(reply, "ai");

    // Persona TTS
    speak(reply, transparency);

    // Subtle stinger for creepy persona when answer lands
    if (currentPreset === "creepy") {
      playStinger("sfx/creak_stinger.mp3", 0.18);
    }

    // Ensure/refresh ambient based on preset + slider
    maybeStartAmbient();
    setAmbientGain(ambientGainForTransparency(transparency));

    logEvent("answer_ok", { transparency, preset: currentPreset });

  } catch (e) {
    try { pending.remove(); } catch {}
    addBubble("Error: " + (e.message || e), "ai");
    logEvent("answer_error", { transparency, preset: currentPreset });
    console.error(e);

  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ---- Bind buttons + Enter ----
sendBtn?.addEventListener("click", send);
inputEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
