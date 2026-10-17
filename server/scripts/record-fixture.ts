import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { extractClaims } from "../llm/extract";

process.env.MOCK_LLM = "false";

const transcriptA = await readFile("samples/webb-march.txt", "utf8");
const transcriptB = await readFile("samples/webb-september.txt", "utf8");

const result = await extractClaims(transcriptA, transcriptB);
await writeFile("samples/webb-extraction.json", JSON.stringify(result, null, 2));
console.log(`Saved ${result.claims.length} claims to samples/webb-extraction.json`);