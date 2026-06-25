import { AI_VERSION, LEGACY_AI_VERSION, TetrisAI } from "../src/ai.js";
import { TetrisGame } from "../src/tetrisCore.js";

const games = Math.max(1, Number(process.argv[2] ?? 100));
const requestedMode = normalizeMode(process.argv[3] ?? "dt10");
const maxPieces = Math.max(100000, Number(process.argv[4] ?? 100000));
const seedPrefix = "benchmark-compare-dt10";
const modes = [...new Set([LEGACY_AI_VERSION, requestedMode])];
const progressEvery = games >= 1000 ? 100 : 0;
const startedAt = Date.now();
const runs = [];

for (const mode of modes) {
  const modeStartedAt = Date.now();
  const results = [];
  const ai = new TetrisAI({ mode });
  for (let i = 0; i < games; i += 1) {
    results.push(playGame(ai, mode, `${seedPrefix}-${i + 1}`, maxPieces));
    if (progressEvery > 0 && (i + 1) % progressEvery === 0) {
      console.error(`${mode}: finished ${i + 1}/${games}`);
    }
  }
  runs.push(summarizeRun(mode, results, (Date.now() - modeStartedAt) / 1000));
}

console.log(
  JSON.stringify(
    {
      games,
      rule: "10x10, uniform independent 7-piece random, 1 point per cleared line",
      seedPrefix,
      maxPieces,
      elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
      runs,
    },
    null,
    2,
  ),
);

function playGame(ai, mode, seed, maxPiecesPerGame) {
  const game = new TetrisGame({ seed });
  game.start();
  let steps = 0;
  let noMove = false;
  while (game.status === "running" && steps < maxPiecesPerGame) {
    const move = ai.findBestMove(game.getState(), { mode });
    if (!move) {
      noMove = true;
      game.status = "gameover";
      break;
    }
    game.applyMoveTarget(move);
    steps += 1;
  }
  return {
    seed,
    score: game.score,
    lines: game.lines,
    pieces: game.pieces,
    capped: steps >= maxPiecesPerGame && game.status === "running",
    noMove,
  };
}

function summarizeRun(mode, results, elapsedSeconds) {
  const scores = results.map((result) => result.score);
  const pieces = results.map((result) => result.pieces);
  const capped = results.filter((result) => result.capped).length;
  const varianceValue = variance(scores);
  const aiVersion = mode === LEGACY_AI_VERSION ? LEGACY_AI_VERSION : AI_VERSION;
  return {
    games: results.length,
    aiVersion,
    mean: average(scores),
    variance: varianceValue,
    standardDeviation: Math.sqrt(varianceValue),
    min: Math.min(...scores),
    max: Math.max(...scores),
    averagePieces: average(pieces),
    capped,
    truncated: capped > 0,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    scoreCsv: scores.join(","),
  };
}

function normalizeMode(mode) {
  if (mode === "dt10" || mode === AI_VERSION) return "dt10";
  if (mode === "legacy" || mode === LEGACY_AI_VERSION) return LEGACY_AI_VERSION;
  throw new Error(`Unknown AI mode: ${mode}`);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  const meanValue = average(values);
  return average(values.map((value) => (value - meanValue) ** 2));
}
