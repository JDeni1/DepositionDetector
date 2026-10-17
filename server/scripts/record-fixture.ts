import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { extractCandidates, isMockMode } from "../llm/extract";

process.env.MOCK_LLM = "false";

if (isMockMode()) {
  console.error("No ANTHROPIC_API_KEY in .env, so there is nothing to record.");
  process.exit(1);
}

const transcriptA = await readFile("samples/webb-march.txt", "utf8");
const transcriptB = await readFile("samples/webb-september.txt", "utf8");

const result = await extractCandidates(transcriptA, transcriptB);
await writeFile("samples/webb-extraction.json", JSON.stringify(result, null, 2));
console.log(`Saved ${result.candidates.length} candidates to samples/webb-extraction.json`);
