import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { AnalyzeRequestSchema, type AnalyzeResponse } from "../shared/types";
import { extractCandidates, ExtractionError, isMockMode } from "./llm/extract";
import { analyzeCandidates } from "./engine/analyze";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, mock: isMockMode() });
});

app.post("/api/analyze", async (req, res) => {
  const body = AnalyzeRequestSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Both transcripts are required (20 to 100,000 characters each)." });
    return;
  }

  try {
    const { transcriptA, transcriptB } = body.data;
    const extraction = await extractCandidates(transcriptA, transcriptB);
    const response: AnalyzeResponse = {
      mock: isMockMode(),
      findings: analyzeCandidates(extraction.candidates, transcriptA, transcriptB),
    };
    res.json(response);
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
app.listen(port, () => {
  console.log(`API on http://localhost:${port}`);
  if (isMockMode()) {
    console.log("Demo mode: no API key found, using the recorded Webb analysis.");
  }
});
