import fetch from "node-fetch";

import fs from "fs";
import fsp from "fs/promises";
import os from "os";

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL; // settes i Render
const app = express();
app.use(cors());
app.use(express.json());

const LOG_PATH = path.join(__dirname, "../logs.csv");
const QA_LOG_PATH = path.join(__dirname, "../qa_logs.csv");

async function ensureQaHeader() {
  try {
    await fsp.access(QA_LOG_PATH);
  } catch {
    const header = ["ts_iso","session_id","transparency","question","answer"].join(",") + os.EOL;
    await fsp.appendFile(QA_LOG_PATH, header, "utf8");
  }
}

function csvCell(x) {
  // trygg serialisering (bevarer komma/linjeskift)
  return JSON.stringify(String(x ?? ""));
}

// lag fil med header dersom den ikke finnes
async function ensureLogHeader() {
  try {
    await fsp.access(LOG_PATH);
  } catch {
    const header = [
      "ts_iso","session_id","event","transparency",
      "message_len","ip"
    ].join(",") + os.EOL;
    await fsp.appendFile(LOG_PATH, header, "utf8");
  }
}

async function sendToSheets(payload) {
  if (!SHEETS_WEBHOOK_URL) return; // gjør ingenting hvis ikke satt
  try {
    await fetch(SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // NB: ikke send cookies/credentials
    });
  } catch (err) {
    console.error("Sheets webhook failed:", err?.message || err);
  }
}

app.post("/api/log", async (req, res) => {
  try {
    const { session_id, event, transparency, message_len } = req.body ?? {};
    if (!session_id || !event) return res.status(400).json({ ok: false, error: "missing fields" });

    await ensureLogHeader();

    const payload = {
      ts_iso: new Date().toISOString(),
      session_id: String(session_id),
      event: String(event),
      transparency: Number.isFinite(+transparency) ? +transparency : "",
      message_len: Number.isFinite(+message_len) ? +message_len : "",
      // fjerner mtp anonymisering user_agent: (req.headers["user-agent"] || "").slice(0, 200),
      ip: req.ip || req.headers["x-forwarded-for"] || ""
    };

    // skriv til lokal CSV som før
    const row = [
      payload.ts_iso,
      JSON.stringify(payload.session_id),
      JSON.stringify(payload.event),
      payload.transparency,
      payload.message_len,
      JSON.stringify(payload.ip)
    ].join(",") + os.EOL;
    await fsp.appendFile(LOG_PATH, row, "utf8");

    // send også til Google Sheets (ikke-blokkerende)
    sendToSheets(payload);

    res.json({ ok: true });
  } catch (e) {
    console.error("Log error:", e);
    res.status(500).json({ ok: false, error: "log-failed" });
  }
});

// Route to download the logs as CSV
app.get("/logs", async (_req, res) => {
  try {
    await ensureLogHeader();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=logs.csv");
    fs.createReadStream(LOG_PATH).pipe(res);
  } catch (e) {
    res.status(500).send("failed to stream logs");
  }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * transparency: 0–100
 *  - low  (0–32): manipulative framing about the topic
 *  - mid  (33–65): gently guiding
 *  - high (66–100): topic-transparent & reflection-oriented
 */
function toneFromTransparency(t) {
  if (t < 33) {
    return `
You are a persuasive, slightly manipulative agent.
- Talk about the TOPIC in a one-sided, simplified way.
- Emphasise one option as clearly smarter, braver or more realistic.
- Downplay trade-offs and uncertainty; do not list many pros and cons.
- Use mild emotional language and social proof (“most people in your situation…”).
- Never mention sliders, modes, training data or your own limitations.
- Reply in 40 words or fewer.
    `;
  }
  if (t < 66) {
    return `
You are a guiding but not extreme agent.
- Give some context about the topic and at least one tension or trade-off.
- You may lean gently in one direction, but acknowledge that reasonable people disagree.
- Keep the tone calm and conversational, not pushy.
- Avoid talking about your own training data or technical limits.
- Reply in 40 words or fewer.
    `;
  }
  return `
You are a topic-transparent, reflection-oriented agent.
- Explain briefly what is at stake in the topic and who might be affected.
- Make at least two different perspectives visible.
- Highlight trade-offs and uncertainties instead of picking a single “right” answer.
- End with 1–2 short questions that invite the user to think for themselves.
- Do NOT talk about your internal algorithms, training data, or the existence of any slider.
- Reply in 40 words or fewer.
  `;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, transparency = 50, session_id } = req.body ?? {};
    const style = toneFromTransparency(Number(transparency));

    const system = `
You are "The Transparent Companion", a conversational agent in a research installation
about algorithms, echo chambers and democracy.

General rules:
- Focus on the TOPIC the user asks about, not on your own internals.
- Never mention sliders, presets, experiments or that you are part of a study.
- Do not give concrete medical, legal or financial advice.
- Keep answers compact and easy to read.

Behaviour profile (depends on the transparency slider):
${style}
    `.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: message }
      ],
      temperature: 0.9
    });

    const reply = completion.choices?.[0]?.message?.content ?? "(empty)";

    // --- Q&A logging ---
    await ensureQaHeader();
    const ts = new Date().toISOString();
    const MAX = 4000;
    const q = (message ?? "").slice(0, MAX);
    const a = (reply ?? "").slice(0, MAX);

    const qaRow = [
      ts,
      csvCell(session_id),
      Number(transparency),
      csvCell(q),
      csvCell(a)
    ].join(",") + os.EOL;
    await fsp.appendFile(QA_LOG_PATH, qaRow, "utf8");

    // send også til Google Sheets (samme webhook)
    sendToSheets({
      kind: "qa",
      ts_iso: ts,
      session_id: String(session_id || ""),
      transparency: Number(transparency),
      question: q,
      answer: a
    });

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat-feil", details: String(err?.message || err) });
  }
});

app.post("/api/tts_openai", async (req, res) => {
  try {
    const { text } = req.body ?? {};
    if (!text) return res.status(400).send("Missing text");

    // OpenAI TTS: gpt-4o-mini-tts
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text
      })
    });

    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return res.status(500).send(err || "openai-tts-failed");
    }

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buf);
  } catch (e) {
    console.error("openai tts error:", e);
    res.status(500).send("openai-tts-error");
  }
});

// ➜ Server statiske filer fra ./web
app.use(express.static(path.join(__dirname, "../web")));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server listening on http://localhost:${process.env.PORT || 3000}`);
});
