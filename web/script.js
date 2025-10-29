const API_BASE = "";

const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const sliderEl = document.getElementById("transparency");

// ---- Session id for anonym logging ----
const SID_KEY = "tc_session_id";
let sessionId = localStorage.getItem(SID_KEY);
if (!sessionId) {
  sessionId = crypto.getRandomValues(new Uint32Array(4)).join("-");
  localStorage.setItem(SID_KEY, sessionId);
}

// ---- Logging helper ----
async function logEvent(event, { transparency, message_len } = {}) {
  try {
    await fetch(`${API_BASE}/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        event,
        transparency,
        message_len
      })
    });
  } catch {
    // Logging skal aldri knekke UI
  }
}

// ----- Robust English voice selection -----
let enVoice = null;

function pickEnglishVoice() {
  const voices = speechSynthesis.getVoices();
  enVoice = voices.find(v => /en/i.test(v.lang) && !/no/i.test(v.lang)) || voices[0] || null;
}

// Kjør både nå og når stemmene faktisk lastes
speechSynthesis.onvoiceschanged = pickEnglishVoice;
setTimeout(pickEnglishVoice, 100);

// ---- Chat UI helpers ----
function addBubble(text, who = "ai") {
  const div = document.createElement("div");
  div.className = "bubble " + (who === "me" ? "me" : "ai");
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// ---- Debounce logging når slider flyttes ----
let logTimer = null;
sliderEl.addEventListener("input", () => {
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    const t = Number(sliderEl.value);
    logEvent("slider_change", { transparency: t });
  }, 250);
});

// ---- Send chat message ----
async function send() {
  const msg = inputEl.value.trim();
  if (!msg) return;

  const transparency = Number(sliderEl.value);

  // Logg event (ikke innholdet)
  logEvent("question_submitted", { transparency, message_len: msg.length });

  addBubble(msg, "me");
  inputEl.value = "";
  sendBtn.disabled = true;

  // "Thinking…" indikator
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
        session_id: sessionId // viktig for Q&A logging!
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

    // ----- TTS (English voice) -----
    const u = new SpeechSynthesisUtterance(reply);
    if (enVoice) u.voice = enVoice;

    if (transparency < 33) { u.rate = 1.05; u.pitch = 0.9; }
    else if (transparency < 66) { u.rate = 1.0; u.pitch = 1.0; }
    else { u.rate = 0.95; u.pitch = 1.05; }

    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    // -----------------------------------

    logEvent("answer_ok", { transparency });

  } catch (e) {
    try { pending.remove(); } catch {}
    addBubble("Error: " + (e.message || e), "ai");
    logEvent("answer_error", { transparency });
    console.error(e);

  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ---- Koble knapper + Enter ----
if (sendBtn) sendBtn.addEventListener("click", send);
if (inputEl) inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});
