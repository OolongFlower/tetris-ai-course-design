import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  aiVersionForMode,
  createAi,
  createProfileStats,
  DEFAULT_MAX_PIECES,
  DEFAULT_SEED_PREFIX,
  normalizeProfile,
  parseArgs,
  playGameWithAi,
  seedForGame,
  summarizeResults,
} from "./lib/benchmarkCore.mjs";

const args = parseArgs(process.argv.slice(2));
const games = Math.max(1, Number(args.games ?? 10));
const maxPieces = Math.max(DEFAULT_MAX_PIECES, Number(args.maxPieces ?? DEFAULT_MAX_PIECES));
const mode = normalizeProfile(args.profile ?? "dt10-2013");
const seedPrefix = String(args.seedPrefix ?? DEFAULT_SEED_PREFIX);
const output = args.output ? String(args.output) : null;
const ai = createAi(mode);
const profileStats = createProfileStats();
const results = [];
const startedAt = performance.now();

for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  results.push(
    playGameWithAi(ai, {
      gameIndex,
      seed: seedForGame(seedPrefix, gameIndex),
      mode,
      maxPieces,
      profileStats,
    }),
  );
}

const elapsedSeconds = (performance.now() - startedAt) / 1000;
const summary = summarizeResults(results, elapsedSeconds);
const totalPieces = summary.totalPieces;
const totalCandidatePlacements = profileStats.candidatePlacements;
const knownMs =
  profileStats.aiMs +
  profileStats.applyMoveTargetMs +
  profileStats.rngAndGenerationMs;
const report = {
  games,
  aiVersion: aiVersionForMode(mode),
  seedPrefix,
  maxPieces,
  totalPieces,
  totalCandidatePlacements,
  elapsedSeconds: round(elapsedSeconds),
  gamesPerSecond: round(summary.gamesPerSecond),
  piecesPerSecond: round(summary.piecesPerSecond),
  candidatesPerSecond: round(totalCandidatePlacements / elapsedSeconds),
  averageAiMsPerStep: round(totalPieces > 0 ? profileStats.aiMs / totalPieces : 0),
  timingsMs: {
    aiTotal: round(profileStats.aiMs),
    enumeratePlacements: round(profileStats.enumerateMs),
    applyPlacement: round(profileStats.applyPlacementMs),
    evaluateBoardFeatures: round(profileStats.featuresMs),
    rngAndPieceGeneration: round(profileStats.rngAndGenerationMs),
    gameApplyMoveTarget: round(profileStats.applyMoveTargetMs),
    other: round(Math.max(0, elapsedSeconds * 1000 - knownMs)),
  },
  capped: summary.capped,
  mean: summary.mean,
  variance: summary.variance,
  min: summary.min,
  max: summary.max,
  averagePieces: summary.averagePieces,
};

const text = `${JSON.stringify(report, null, 2)}\n`;
if (output) writeFileSync(output, text);
console.log(text.trimEnd());

function round(value) {
  return Number(value.toFixed(6));
}
