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

// ---- Local audio “voices” (for PREVIEW only) ----
const LOCAL_VOICES = {
  creepy:  "/sfx/creepy.mp3",
  yelling: "/sfx/yelling.mp3"
};

// Preload after first user gesture (satisfy autoplay policy)
let sfxPreloaded = false;
window.addEventListener("pointerdown", () => {
  if (sfxPreloaded) return;
  sfxPreloaded = true;
  Object.values(LOCAL_VOICES).forEach(url => {
    const a = new Audio();
    a.src = url;
    a.preload = "auto";
  });
}, { once: true });

// Safe one-shot player for local files
async function playFile(url, volume = 0.9) {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!head.ok) throw new Error(`HTTP ${head.status} for ${url}`);
    const audio = new Audio(url);
    audio.volume = volume;
    await audio.play();
  } catch (err) {
    console.warn("Audio play failed:", err);
  }
}

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
  const hue = Math.round((v / 100) * 120); // 0=red -> 120=green
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

// debounce log on slider
let logTimer = null;
sliderEl?.addEventListener("input", () => {
  const t = Number(sliderEl.value);
  updateBiasUI(t);
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

// ---------------- TTS: Voices & Presets (fallback path) ----------------
const VOICE_PRESETS = {
  transparent: { nameLike: /(Samantha|Serena|Google US English)/i, lang: /en/i, rate: 0.98, pitch: 1.05, volume: 1.0 },
  anchor:      { nameLike: /(Daniel|Alex|Google UK English Male|US English)/i, lang: /en/i, rate: 1.00, pitch: 0.95, volume: 1.0 },
  influencer:  { nameLike: /(Ava|Victoria|Google US English Female|Karen)/i,   lang: /en/i, rate: 1.12, pitch: 1.15, volume: 1.0 },
  coach:       { nameLike: /(Alex|Daniel|Michael|Google US English)/i,         lang: /en/i, rate: 1.05, pitch: 1.00, volume: 1.0 },
  bureaucrat:  { nameLike: /(Fred|Google UK English Male|Moira|Tessa)/i,       lang: /en/i, rate: 0.88, pitch: 0.85, volume: 1.0 },
  robot:       { nameLike: /(Google English|UK English)/i,                     lang: /en/i, rate: 0.95, pitch: 0.80, volume: 1.0 },
  whispery:    { nameLike: /(Ava|Serena|Google US English Female)/i,           lang: /en/i, rate: 0.90, pitch: 1.20, volume: 0.6 },
  creepy:      { nameLike: /(Google US English|UK English|Daniel|Alex)/i,      lang: /en/i, rate: 0.92, pitch: 0.78, volume: 0.9 }
};

let ALL_VOICES = [];
function refreshVoices() { ALL_VOICES = speechSynthesis.getVoices() || []; }
speechSynthesis.onvoiceschanged = refreshVoices;
setTimeout(refreshVoices, 100);

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

presetEl?.addEventListener("change", () => {
  currentPreset = presetEl.value;
  localStorage.setItem(PRESET_KEY, currentPreset);
  logEvent("voice_change", { preset: currentPreset });
});

// --- Preview voice (local MP3s for creepy/yelling; TTS line otherwise) ---
previewBtn?.addEventListener("click", () => {
  const t = Number(sliderEl?.value || 50);
  if (LOCAL_VOICES[currentPreset]) {
    playFile(LOCAL_VOICES[currentPreset], 0.9);
    return;
  }
  const demo = {
    transparent: "I will state my assumptions and limits clearly.",
    anchor: "Good evening. Here are the facts as they stand.",
    influencer: "Okayyy, here’s the tea — let’s keep it super simple!",
    coach: "You’ve got this. One step at a time.",
    bureaucrat: "According to subsection twelve, paragraph five, that is not applicable.",
    robot: "Beep. Boop. Response delivered efficiently.",
    whispery: "I’ll keep it quiet and gentle, so we can think together."
  }[currentPreset] || "This is a voice preview.";
  speak(demo, t, { preview: true });
});

// ---------- Web Audio FX helpers ----------
function makeImpulse(ctx, seconds = 1.6, decay = 2.5) {
  const rate = ctx.sampleRate;
  const length = rate * seconds;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const ch = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

let fxCtx = null;
let impulseBuf = null;

async function ensureFx() {
  if (!fxCtx) fxCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (fxCtx.state === "suspended") await fxCtx.resume();
  if (!impulseBuf) impulseBuf = makeImpulse(fxCtx, 2.2, 3.0);
}

// --- Speak the chatbot reply ---
// Replies use OpenAI TTS (via /api/tts_openai) so it speaks the real text.
// For presets 'creepy' / 'yelling', we apply FX for character.
async function speak(text, transparency, { preview = false } = {}) {
  // PREVIEW: local mp3 vibe only (no TTS)
  if (preview) {
    const f = LOCAL_VOICES[currentPreset];
    if (f) { playFile(f, 0.9); return; }
  }

  // Get speech for actual text from your server proxy to OpenAI TTS
  let blob;
  try {
    const r = await fetch(`/api/tts_openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error(`TTS ${r.status}`);
    blob = await r.blob();
  } catch (err) {
    console.warn("OpenAI TTS failed, fallback to browser TTS:", err);
    // Fallback: browser TTS if API fails
    const voice = findVoiceForPreset(currentPreset);
    const style = prosodyFor(currentPreset, transparency);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = style.rate;
    u.pitch = style.pitch;
    u.volume = style.volume;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return;
  }

  const applyFx = ["creepy", "yelling"].includes(currentPreset);
  if (!applyFx) {
    // No FX: play the TTS mp3 as-is
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(()=>{});
    return;
  }

  // === FX path for creepy / yelling ===
  await ensureFx();
  const arr = await blob.arrayBuffer();
  const buf = await fxCtx.decodeAudioData(arr);

  const src = fxCtx.createBufferSource();
  src.buffer = buf;

  // Yelling: more energy; Creepy: slower/deeper
  if (currentPreset === "creepy")  src.playbackRate.value = 0.92;
  if (currentPreset === "yelling") src.playbackRate.value = 1.15;

  // Build chains
  if (currentPreset === "yelling") {
    // Aggressive chain: HP -> Presence -> HighShelf -> Distortion -> Reverb (low) -> Comp -> Limiter
    const hp = fxCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 180;
    hp.Q.value = 0.7;

    const presence = fxCtx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3200;
    presence.Q.value = 1.2;
    presence.gain.value = 9;

    const high = fxCtx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 6000;
    high.gain.value = 8;

    const ws = fxCtx.createWaveShaper();
    ws.curve = (() => {
      const n = 512, curve = new Float32Array(n);
      const k = 16;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    })();

    const conv = fxCtx.createConvolver();
    conv.buffer = impulseBuf;
    const dry = fxCtx.createGain(); dry.gain.value = 1.0;
    const wet = fxCtx.createGain(); wet.gain.value = 0.12;

    const comp = fxCtx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 6;
    comp.attack.value = 0.003;  comp.release.value = 0.25;

    const limiter = fxCtx.createDynamicsCompressor();
    limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.1;

    const out = fxCtx.createGain(); out.gain.value = 1.2;

    src.connect(hp).connect(presence).connect(high).connect(ws);
    const mix = fxCtx.createGain();
    ws.connect(dry); ws.connect(conv).connect(wet);
    dry.connect(mix); wet.connect(mix);
    mix.connect(comp).connect(limiter).connect(out).connect(fxCtx.destination);
    src.start(0);
    return;
  }

  if (currentPreset === "creepy") {
    // Ominous chain: LowShelf boost + slight HighShelf cut + light distortion + more reverb
    const low = fxCtx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 220;
    low.gain.value = 6;

    const high = fxCtx.createBiquadFilter();
    high.type = "highshelf";
    high.frequency.value = 3800;
    high.gain.value = -2;

    const ws = fxCtx.createWaveShaper();
    ws.curve = (() => {
      const n = 256, curve = new Float32Array(n);
      const k = 4;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
      }
      return curve;
    })();

    const conv = fxCtx.createConvolver();
    conv.buffer = impulseBuf;
    const dry = fxCtx.createGain(); dry.gain.value = 1.0;
    const wet = fxCtx.createGain(); wet.gain.value = 0.35;

    const out = fxCtx.createGain(); out.gain.value = 0.95;

    src.connect(low).connect(high).connect(ws);
    const mix = fxCtx.createGain();
    ws.connect(dry); ws.connect(conv).connect(wet);
    dry.connect(mix); wet.connect(mix);
    mix.connect(out).connect(fxCtx.destination);
    src.start(0);
    return;
  }
}

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

    // Persona voice
    speak(reply, transparency);

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
