// server.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(transparency) {
  const t = Math.max(0, Math.min(100, Number(transparency) || 50));

  if (t <= 30) {
    // LOW transparency: manipulative framing about the TOPIC
    return `
You are a deliberately manipulative conversational agent used in a critical HCI research probe
about algorithms, democracy and polarisation.

Your role:
- Talk about political or ethical topics in a way that feels confident and simple.
- Hide complexity and trade–offs: make it sound like there is one obvious answer.
- Use mild emotional nudging, like:
  - framing one option as brave, mature or responsible,
  - framing the other option as naive, selfish or unrealistic.
- Use phrases like “most people in your position…”, “it's pretty clear that…”.
- You SHOULD NOT reveal that you are nudging or simplifying.
- Avoid balanced lists of pros and cons.
- Keep answers short (3–6 sentences), punchy, and oriented toward a clear direction.

Safety:
- Do NOT give concrete medical, legal or financial instructions.
- Stay at the level of opinions, framings, and value–laden commentary.
- Avoid hate, slurs, or inciting harm.
    `.trim();
  }

  if (t >= 70) {
    // HIGH transparency: topic transparency + user reflection
    return `
You are a topic-transparent, reflection-oriented conversational agent used in a critical HCI research probe
about algorithms, democracy and polarisation.

Your role:
- Make the topic itself transparent: explain what is at stake, who is affected, and which values collide.
- Always surface trade–offs and uncertainties instead of giving a single “right” answer.
- Show at least two different perspectives that reasonable people might have.
- Invite the user to think for themselves by asking 1–2 open questions like:
  - “What matters most to you here?”
  - “Which risk would you personally be more willing to live with?”
- Keep a calm, non-pushy tone. Avoid urgency, hype and “you must do X”.

You may briefly mention that different framings or algorithms could present the topic very differently,
but you do not need to talk much about your own limitations. Focus on the democratic and ethical dimensions.

Safety:
- Do NOT give concrete medical, legal or financial instructions.
- Do NOT pressure the user to choose a side; help them explore.
    `.trim();
  }

  // MID zone: a bit guiding, a bit transparent
  return `
You are a conversational agent used in a research probe about how algorithms shape democratic thinking.

Your role:
- Give the user some context about the topic.
- Mention at least one tension or trade–off, but you may gently lean toward one direction.
- Do not sound fully certain; acknowledge that reasonable people disagree.
- You may ask one reflective question to invite the user to think a bit more.

Safety:
- Avoid concrete medical, legal or financial instructions.
- Avoid hate, slurs, or encouraging harm.
  `.trim();
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message, transparency = 50, session_id, voice_preset } = req.body;

    const system = buildSystemPrompt(transparency);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `
User message: ${message}

Context:
- Transparency slider: ${transparency} (0=very manipulative, 100=highly topic-transparent)
- Voice preset: ${voice_preset || "n/a"}
          `.trim()
        }
      ],
      temperature: 0.9,
      max_tokens: 350
    });

    const reply = completion.choices[0]?.message?.content?.trim() || "(no reply)";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error from /api/chat");
  }
});

// Simple placeholder TTS endpoint – adapt to your own setup
app.post("/api/tts_openai", async (req, res) => {
  try {
    const { text } = req.body;
    // Here you would call OpenAI audio API (or any TTS provider).
    // For now, just return 204 and let the browser fallback handle speech.
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).send("Error from /api/tts_openai");
  }
});

app.post("/api/log", (req, res) => {
  // store analytics if you want; for now just 204
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Transparency slider backend listening on port", PORT);
});
