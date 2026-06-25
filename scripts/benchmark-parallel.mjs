import { writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import {
  aiVersionForMode,
  DEFAULT_MAX_PIECES,
  DEFAULT_SEED_PREFIX,
  normalizeProfile,
  parseArgs,
  resultsToCsv,
  summarizeResults,
} from "./lib/benchmarkCore.mjs";

const args = parseArgs(process.argv.slice(2));
const games = Math.max(1, Number(args.games ?? 100));
const profile = String(args.profile ?? "dt10-2013");
const mode = normalizeProfile(profile);
const maxPieces = Math.max(DEFAULT_MAX_PIECES, Number(args.maxPieces ?? DEFAULT_MAX_PIECES));
const seedPrefix = String(args.seedPrefix ?? DEFAULT_SEED_PREFIX);
const output = args.output ? String(args.output) : null;
const jsonOutput = args.json ? String(args.json) : output ? output.replace(/\.csv$/i, ".json") : null;
const cpuCores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const workers = parseWorkers(args.workers ?? "auto", cpuCores);
const progressEvery = Math.max(1, Number(args.progressEvery ?? 50));
const quiet = Boolean(args.quiet);
const startedAt = performance.now();

const results = [];
let completed = 0;

await Promise.all(
  Array.from({ length: workers }, (_, workerId) => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./benchmark-worker.mjs", import.meta.url), {
        workerData: {
          workerId,
          workerCount: workers,
          games,
          profile,
          maxPieces,
          seedPrefix,
          progressEvery,
        },
      });
      worker.on("message", (message) => {
        if (message.type === "progress") {
          completed += progressEvery;
          if (!quiet) writeProgress(Math.min(completed, games), games);
        } else if (message.type === "done") {
          completed += message.completed % progressEvery;
          results.push(...message.results);
          if (!quiet) writeProgress(Math.min(completed, games), games);
          resolve();
        }
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error(`Worker ${workerId} stopped with code ${code}`));
      });
    });
  }),
);

results.sort((a, b) => a.gameIndex - b.gameIndex);
const elapsedSeconds = (performance.now() - startedAt) / 1000;
const summary = summarizeResults(results, elapsedSeconds);
const report = {
  games,
  aiVersion: aiVersionForMode(mode),
  profile,
  seedPrefix,
  maxPieces,
  workers,
  cpuCores,
  ...summary,
  scoreCsv: results.map((result) => result.score).join(","),
};

if (output) writeFileSync(output, resultsToCsv(results));
if (jsonOutput) writeFileSync(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
if (!quiet) process.stderr.write("\n");
console.log(JSON.stringify(report, null, 2));

function parseWorkers(value, cores) {
  if (value === "auto") return Math.max(1, cores - 1);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid --workers value: ${value}`);
  }
  return parsed;
}

function writeProgress(done, total) {
  const percent = total > 0 ? ((done / total) * 100).toFixed(1) : "100.0";
  process.stderr.write(`\rcompleted ${done}/${total} (${percent}%)`);
}
