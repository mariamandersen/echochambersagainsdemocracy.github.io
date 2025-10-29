// Fungerer både når du åpner via http://localhost:3001 og file://
const API_BASE = (location.origin.startsWith('http') && location.hostname === 'localhost')
  ? '' // same-origin, /api/chat
  : 'http://localhost:3001'; // fallback for file://

const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const sliderEl = document.getElementById("transparency");

// last voices asynkront (Chrome quirk)
speechSynthesis.onvoiceschanged = () => {};

function addBubble(text, who = "ai") {
  const div = document.createElement("div");
  div.className = "bubble " + (who === "me" ? "me" : "ai");
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function send() {
  const msg = inputEl.value.trim();
  if (!msg) return;
  addBubble(msg, "me");
  inputEl.value = "";
  sendBtn.disabled = true;

  const transparency = Number(sliderEl.value);

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, transparency })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`);
    }

    const data = await res.json();
    const reply = data.reply || "(empty reply)";
    addBubble(reply, "ai");

    // ----- TTS (English voice) -----
    const u = new SpeechSynthesisUtterance(reply);

    // Finn en engelsk stemme (ikke norsk)
    const voices = speechSynthesis.getVoices();
    const enVoice = voices.find(v => /en/i.test(v.lang) && !/no/i.test(v.lang));
    if (enVoice) u.voice = enVoice;

    // Tone tweaks
    if (transparency < 33) { u.rate = 1.05; u.pitch = 0.9; }
    else if (transparency < 66) { u.rate = 1.0; u.pitch = 1.0; }
    else { u.rate = 0.95; u.pitch = 1.05; }

    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    // --------------------------------

  } catch (e) {
    addBubble("Error: " + (e.message || e), "ai");
    console.error(e);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// Koble knapper/taster
if (sendBtn) sendBtn.addEventListener("click", send);
if (inputEl) inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
