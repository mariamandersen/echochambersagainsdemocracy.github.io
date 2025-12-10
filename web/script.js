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
  const t = Math.max(0, Math.min(100, Number(v) || 50));
  const hue = Math.round((t / 100) * 120); // 0=red -> 120=green
  document.documentElement.style.setProperty('--bias-hue', hue);
  const lbl = document.getElementById('toneLabel');
  if (lbl) {
    if (t < 33) {
      lbl.textContent =
        'Mode: Manipulative – one-sided, simplified framing that nudges you toward one answer.';
    } else if (t < 66) {
      lbl.textContent =
        'Mode: Guiding – gives some context, but still steers you gently in a direction.';
    } else {
      lbl.textContent =
        'Mode: Topic-transparent – explains stakes and trade-offs, then invites you to decide yourself.';
    }
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
  transparent: { nameLike: /(Samantha|Serena|Google US English)/i, lang: /en/i, rate: 1.0,  pitch: 1.05, volume: 1.0 },
  yelling:     { nameLike: /(Daniel|Alex|Google US English Male)/i, lang: /en/i, rate: 1.25, pitch: 1.1,  volume: 1.0 },
  creepy:      { nameLike: /(Google US English|UK English|Daniel|Alex)/i, lang: /en/i, rate: 0.82, pitch: 0.8,  volume: 0.9 },
  seductive:   { nameLike: /(Ava|Victoria|Google US English Female|Karen)/i, lang: /en/i, rate: 0.9,  pitch: 1.15, volume: 0.9 },
  open:        { nameLike: /(Samantha|Serena|Google US English)/i, lang: /en/i, rate: 1.08, pitch: 1.1,  volume: 1.0 },
  sleazy:      { nameLike: /(Google US English Male|Daniel|Alex)/i, lang: /en/i, rate: 1.15, pitch: 1.05, volume: 1.0 },
  bureaucrat:  { nameLike: /(Fred|Google UK English Male|Moira|Tessa)/i, lang: /en/i, rate: 0.9,  pitch: 0.9,  volume: 1.0 },
  robot:       { nameLike: /(Google English|UK English)/i, lang: /en/i, rate: 0.95, pitch: 0.75, volume: 1.0 },
  whispery:    { nameLike: /(Ava|Serena|Google US English Female)/i, lang: /en/i, rate: 0.85, pitch: 1.2,  volume: 0.6 }
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
let currentPreset = localStorage.getItem(PRESET_KEY) || "open";
if (!VOICE_PRESETS[currentPreset]) currentPreset = "open";

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
    open:      "This is a big topic, and I’m excited to walk through what’s at stake with you.",
    yelling:   "Listen, this is a huge deal and you really can’t just shrug it off!",
    creepy:    "If you look a little closer, things aren’t as harmless as they first appear.",
    seductive: "It’s kind of tempting, isn’t it, when you think about where this choice could lead you…",
    sleazy:    "Look, this is basically a no-brainer – you’d be silly not to lean this way, right?",
    bureaucrat:"In this case, the question breaks down into several clearly defined considerations.",
    robot:     "I will now provide a concise evaluation of this topic for you.",
    whispery:  "Let’s keep this between us and quietly look at both sides."
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
// --- Speak the chatbot reply ---
// Replies use OpenAI TTS (via /api/tts_openai) so it speaks the real text.
// For now we play *clean* audio for all personas so it’s clear and not glitchy.
// --- Speak the chatbot reply ---
// Now uses Dia for real replies, per persona.
async function speak(text, transparency, { preview = false } = {}) {
  // PREVIEW: keep your existing behaviour
  if (preview) {
    const f = LOCAL_VOICES[currentPreset];
    if (f) {
      playFile(f, 0.9);
      return;
    }
    // fallback preview sentence with browser TTS
    const demo = {
      open:      "This is a big topic, and I’m excited to walk through what’s at stake with you.",
      yelling:   "Listen, this is a huge deal and you really can’t just shrug it off!",
      creepy:    "If you look a little closer, things aren’t as harmless as they first appear.",
      seductive: "It’s kind of tempting, isn’t it, when you think about where this choice could lead you…",
      sleazy:    "Look, this is basically a no-brainer – you’d be silly not to lean this way, right?",
      bureaucrat:"In this case, the question breaks down into several clearly defined considerations.",
      robot:     "I will now provide a concise evaluation of this topic for you.",
      whispery:  "Let’s keep this between us and quietly look at both sides."
    }[currentPreset] || "This is a voice preview.";
    const voice = findVoiceForPreset(currentPreset);
    const style = prosodyFor(currentPreset, transparency);
    const u = new SpeechSynthesisUtterance(demo);
    if (voice) u.voice = voice;
    u.rate = style.rate;
    u.pitch = style.pitch;
    u.volume = style.volume;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return;
  }

  // REAL TTS via Dia
  try {
    const r = await fetch(`/api/tts_dia`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, preset: currentPreset })
    });
    if (!r.ok) throw new Error(`Dia TTS ${r.status}`);
    const data = await r.json();
    if (!data.url) throw new Error("No URL from Dia TTS");

    const audio = new Audio(data.url);
    audio.play().catch(err => console.warn("Audio play failed:", err));
  } catch (err) {
    console.warn("Dia TTS failed, fallback to browser TTS:", err);
    // Fallback: browser TTS
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
        session_id: sessionId,
        voice_preset: currentPreset
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
