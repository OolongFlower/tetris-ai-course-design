import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  aiVersionForMode,
  createAi,
  DEFAULT_MAX_PIECES,
  DEFAULT_SEED_PREFIX,
  normalizeProfile,
  parseArgs,
  playGameWithAi,
  seedForGame,
  summarizeResults,
} from "./lib/benchmarkCore.mjs";

const args = parseArgs(process.argv.slice(2));
const games = Math.max(1, Number(args.games ?? 100));
const actionGames = Math.max(0, Math.min(games, Number(args.actionGames ?? 10)));
const maxPieces = Math.max(DEFAULT_MAX_PIECES, Number(args.maxPieces ?? DEFAULT_MAX_PIECES));
const mode = normalizeProfile(args.profile ?? "dt10-2013");
const seedPrefix = String(args.seedPrefix ?? DEFAULT_SEED_PREFIX);
const output = String(args.output ?? "parity-before.json");
const ai = createAi(mode);
const results = [];
const startedAt = performance.now();

for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  const result = playGameWithAi(ai, {
    gameIndex,
    seed: seedForGame(seedPrefix, gameIndex),
    mode,
    maxPieces,
    recordActions: gameIndex < actionGames,
  });
  results.push(result);
}

const elapsedSeconds = (performance.now() - startedAt) / 1000;
const summary = summarizeResults(results, elapsedSeconds);
const report = {
  aiVersion: aiVersionForMode(mode),
  seedPrefix,
  games,
  actionGames,
  maxPieces,
  summary,
  gamesResult: results.map((result) => ({
    gameIndex: result.gameIndex,
    seed: result.seed,
    score: result.score,
    pieces: result.pieces,
    lines: result.lines,
    capped: result.capped,
    actions: result.actions ?? undefined,
  })),
};

writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output,
      games,
      actionGames,
      mean: summary.mean,
      variance: summary.variance,
      capped: summary.capped,
      elapsedSeconds: summary.elapsedSeconds,
    },
    null,
    2,
  ),
);
