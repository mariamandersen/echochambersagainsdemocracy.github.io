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
    // bevisst stille: logging skal aldri knekke UI
  }
}

// last voices asynkront (Chrome quirk)
speechSynthesis.onvoiceschanged = () => {};

function addBubble(text, who = "ai") {
  const div = document.createElement("div");
  div.className = "bubble " + (who === "me" ? "me" : "ai");
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// Debounce logging når slider flyttes
let logTimer = null;
sliderEl.addEventListener("input", () => {
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    logEvent("slider_change", { transparency: Number(sliderEl.value) });
  }, 250);
});

async function send() {
  const msg = inputEl.value.trim();
  if (!msg) return;

  const transparency = Number(sliderEl.value);

  // logg at spørsmål sendes (uten innhold)
  logEvent("question_submitted", { transparency, message_len: msg.length });

  addBubble(msg, "me");
  inputEl.value = "";
  sendBtn.disabled = true;

  // Vis "…thinking"
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
        session_id: sessionId   // ← viktig
      })
    });
    

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`);
    }

    const data = await res.json();
    const reply = data.reply || "(empty reply)";

    // fjern “…thinking” når vi har svar
    pending.remove();

    addBubble(reply, "ai");

    // ----- TTS (English voice) -----
    const u = new SpeechSynthesisUtterance(reply);
    const voices = speechSynthesis.getVoices();
    const enVoice = voices.find(v => /en/i.test(v.lang) && !/no/i.test(v.lang));
    if (enVoice) u.voice = enVoice;
    if (transparency < 33) { u.rate = 1.05; u.pitch = 0.9; }
    else if (transparency < 66) { u.rate = 1.0; u.pitch = 1.0; }
    else { u.rate = 0.95; u.pitch = 1.05; }
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    // --------------------------------

    logEvent("answer_ok", { transparency });

  } catch (e) {
    // sørg for å fjerne pending også ved feil
    try { pending.remove(); } catch {}
    addBubble("Error: " + (e.message || e), "ai");
    logEvent("answer_error", { transparency });
    console.error(e);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// Koble knapper/taster
if (sendBtn) sendBtn.addEventListener("click", send);
if (inputEl) inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
