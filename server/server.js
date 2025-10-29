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
