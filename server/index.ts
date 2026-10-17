import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { AnalyzeRequestSchema } from "../shared/types";
import { extractClaims, ExtractionError } from "./llm/extract";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mock: process.env.MOCK_LLM === "true" });
});

app.post("/api/analyze", async (req, res) => {
  const body = AnalyzeRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Both transcripts are required (20 to 100,000 characters each)." });
    return;
  }

  try {
    const extraction = await extractClaims(body.data.transcriptA, body.data.transcriptB);
    // Next phase: pass extraction.claims into the engine and return contradictions too.
    res.json(extraction);
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "The analysis service is busy. Try again in a minute." });
    } else if (err instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: "Server API key is missing or invalid." });
    } else if (err instanceof ExtractionError) {
      res.status(502).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Analysis failed unexpectedly." });
    }
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
