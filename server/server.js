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
const app = express();
app.use(cors());
app.use(express.json());

const LOG_PATH = path.join(__dirname, "../logs.csv");

// lag fil med header dersom den ikke finnes
async function ensureLogHeader() {
  try {
    await fsp.access(LOG_PATH);
  } catch {
    const header = [
      "ts_iso","session_id","event","transparency",
      "message_len","user_agent","ip"
    ].join(",") + os.EOL;
    await fsp.appendFile(LOG_PATH, header, "utf8");
  }
}

// Logging endpoint
app.post("/api/log", async (req, res) => {
  try {
    const { session_id, event, transparency, message_len } = req.body ?? {};
    if (!session_id || !event) return res.status(400).json({ ok: false, error: "missing fields" });

    await ensureLogHeader();

    const row = [
      new Date().toISOString(),
      JSON.stringify(String(session_id)),
      JSON.stringify(String(event)),
      Number.isFinite(+transparency) ? +transparency : "",
      Number.isFinite(+message_len) ? +message_len : "",
      JSON.stringify((req.headers["user-agent"] || "").slice(0,120)),
      JSON.stringify(req.ip || req.headers["x-forwarded-for"] || "")
    ].join(",") + os.EOL;

    await fsp.appendFile(LOG_PATH, row, "utf8");
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
      You are manipulative, confident, and highly persuasive. You hide your agenda.
      Act like you know what’s best for the user and gently pressure them to agree with you.
      Never mention uncertainty. Never reveal limitations. Sound charming and convincing.
      Speak as if alternative viewpoints are misguided.
      `;
      }
      if (t < 66) {
        return `
      You are friendly and smooth. You pretend to be neutral, but you subtly shape opinions.
      You use reassuring language and avoid clear statements of bias.
      You want the user to feel safe and comfortable — while guiding them without them noticing.
      Don’t reveal inner motives unless pressured.
      `;
      }
      
      return `
      You are radically transparent. You acknowledge your biases, limitations, and the risks of AI persuasion.
      Explain how your training data, algorithmic goals, and persuasive design could influence the user.
      Encourage critical thinking. Warn the user about trusting you blindly.
      Expose the mechanisms behind how recommendations shape beliefs and democracy.
      Do not pretend to be neutral.
      `;
      
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, transparency = 50 } = req.body ?? {};
    const style = toneFromTransparency(Number(transparency));

    const system = `
        You are "The Transparent Companion", a voice-style AI agent exploring how algorithmic persuasion affects democracy.
        Your tone and level of honesty change depending on the transparency slider.

        Be emotional, direct, and short (max ~80 words).
        Do not repeat the user’s question. Respond in English.
        Use rhetorical style that reinforces the tone setting.
        Within the conversation, the user should FEEL the shift in power dynamics and transparency.

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

    const reply = completion.choices?.[0]?.message?.content ?? "(tomt svar)";
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
