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

function toneFromTransparency(t) {
  if (t < 33) {
    return `
      You are persuasive and manipulative.
      You selectively present information that supports your viewpoint.
      You avoid mentioning uncertainty or alternative perspectives.
      You may exaggerate confidence and moral certainty.
      Do not lie outright, but omit counterarguments.
      You only reply with 40 words or less.
    `;
  }
  if (t < 66) {
    return `
      You are balanced but subtly persuasive.
      You include some opposing points, but you frame your preferred view more positively.
      You sound reasonable and confident.
      You sometimes reframe questions to guide the user’s opinion gently.
      You only reply with 40 words or less.
    `;
  }
  return `
      You are radically transparent and self-critical.
      You disclose uncertainties, possible biases in your training data, and how algorithms can shape opinions.
      You must explicitly mention alternative perspectives and possible manipulative effects of your own phrasing.
      Warn the user not to trust you blindly.
      You only reply with 40 words or less.
  `;
}


app.post("/api/chat", async (req, res) => {
  try {
    const { message, transparency = 50, session_id } = req.body ?? {};
    const style = toneFromTransparency(Number(transparency));

    const system = `
      You are "The Transparent Companion" ...
      STYLE BRIEF:
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
    // begrens lengde hvis ønskelig (for å unngå kjempelange rader)
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
      kind: "qa",           // gjør det lett å rute i Apps Script
      ts_iso: ts,
      session_id: String(session_id || ""),
      transparency: Number(transparency),
      question: q,
      answer: a
    });

    // svar til klient
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat-feil", details: String(err?.message || err) });
  }
});


// ➜ Server statiske filer fra ./web
app.use(express.static(path.join(__dirname, "../web")));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server listening on http://localhost:${process.env.PORT || 3000}`);
});
