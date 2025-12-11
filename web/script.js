// --- API base (same-origin on deployed site) ---
const API_BASE = (() => {
  return "";
})();

// --- DOM ---
const chatEl      = document.getElementById("chat");
const inputEl     = document.getElementById("input");
const sendBtn     = document.getElementById("send");
const sliderEl    = document.getElementById("transparency");
// voice/preview removed — focusing on textual tone only

// ---- Session id for anonym logging ----
const SID_KEY = "tc_session_id";
let sessionId = localStorage.getItem(SID_KEY);
if (!sessionId) {
  sessionId = crypto.getRandomValues(new Uint32Array(4)).join("-");
  localStorage.setItem(SID_KEY, sessionId);
}

// NOTE: audio/voice preview removed — keep user focus on textual tone

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

// NOTE: voice presets removed — kept only transparency slider to control textual framing

// TTS removed — responses are text-only. Keep speak() out so UI focuses on textual tone.

// ---------------- Chat ----------------
async function send() {
  const msg = inputEl.value.trim();
  if (!msg) return;

  const transparency = Number(sliderEl.value);
  // removed preset reference — app is text-only now
  logEvent("question_submitted", { transparency, message_len: msg.length });

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

    // Text-only response (tone controlled by transparency slider)

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

// ---- Bind buttons + Enter ----
sendBtn?.addEventListener("click", send);
inputEl?.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
