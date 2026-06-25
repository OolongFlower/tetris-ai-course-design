import { performance } from "node:perf_hooks";
import { AI_VERSION, LEGACY_AI_VERSION, TetrisAI } from "../../src/ai.js";
import { playFastTetrisGame } from "../../src/fastTetris.js";
import { TetrisGame } from "../../src/tetrisCore.js";

export const DEFAULT_MAX_PIECES = 100000;
export const DEFAULT_SEED_PREFIX = "benchmark-10x10";

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function normalizeProfile(profile = "dt10-2013") {
  if (profile === "dt10" || profile === AI_VERSION) return "dt10";
  if (profile === "legacy" || profile === LEGACY_AI_VERSION) return LEGACY_AI_VERSION;
  throw new Error(`Unknown AI profile: ${profile}`);
}

export function aiVersionForMode(mode) {
  return mode === LEGACY_AI_VERSION ? LEGACY_AI_VERSION : AI_VERSION;
}

export function seedForGame(seedPrefix, gameIndex) {
  return `${seedPrefix}-${gameIndex + 1}`;
}

export function createProfileStats() {
  return {
    aiMs: 0,
    enumerateMs: 0,
    applyPlacementMs: 0,
    featuresMs: 0,
    rngAndGenerationMs: 0,
    applyMoveTargetMs: 0,
    candidatePlacements: 0,
  };
}

export function playGameWithAi(ai, options) {
  const {
    gameIndex = 0,
    seed = seedForGame(DEFAULT_SEED_PREFIX, gameIndex),
    mode = "dt10",
    maxPieces = DEFAULT_MAX_PIECES,
    profileStats = null,
    recordActions = false,
  } = options;
  const startedAt = performance.now();
  const game = new TetrisGame({ seed, profile: profileStats });
  const actions = recordActions ? [] : null;
  game.start();
  let steps = 0;
  let noMove = false;
  while (game.status === "running" && steps < maxPieces) {
    const state = game.getState();
    const aiStartedAt = performance.now();
    const move = ai.findBestMove(state, { mode, profile: profileStats });
    const aiElapsed = performance.now() - aiStartedAt;
    if (profileStats) profileStats.aiMs += aiElapsed;
    if (!move) {
      noMove = true;
      game.status = "gameover";
      break;
    }
    if (recordActions) {
      actions.push({
        type: state.current.type,
        rotation: move.rotation,
        x: move.x,
      });
    }
    const applyStartedAt = performance.now();
    const applied = game.applyMoveTarget(move);
    if (profileStats) profileStats.applyMoveTargetMs += performance.now() - applyStartedAt;
    if (!applied) {
      noMove = true;
      game.status = "gameover";
      break;
    }
    steps += 1;
  }
  return {
    gameIndex,
    seed,
    score: game.score,
    lines: game.lines,
    pieces: game.pieces,
    capped: steps >= maxPieces && game.status === "running",
    noMove,
    elapsedMs: performance.now() - startedAt,
    candidatePlacements: profileStats?.candidatePlacements ?? 0,
    actions,
  };
}

export function playBenchmarkGame(options) {
  const {
    engine = "fast",
    gameIndex = 0,
    seed = seedForGame(DEFAULT_SEED_PREFIX, gameIndex),
    mode = "dt10",
    maxPieces = DEFAULT_MAX_PIECES,
    recordActions = false,
  } = options;
  const startedAt = performance.now();
  if (engine === "fast" && mode === "dt10") {
    const result = playFastTetrisGame({ gameIndex, seed, maxPieces, recordActions });
    result.elapsedMs = performance.now() - startedAt;
    return result;
  }
  const profileStats = createProfileStats();
  const ai = options.ai ?? createAi(mode);
  const result = playGameWithAi(ai, {
    gameIndex,
    seed,
    mode,
    maxPieces,
    profileStats,
    recordActions,
  });
  result.candidatePlacements = profileStats.candidatePlacements;
  return result;
}

export function createAi(mode = "dt10") {
  return new TetrisAI({ mode });
}

export function summarizeResults(results, elapsedSeconds) {
  const stats = createWelfordStats();
  let totalPieces = 0;
  let totalCandidatePlacements = 0;
  let capped = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const result of results) {
    addWelford(stats, result.score);
    totalPieces += result.pieces;
    totalCandidatePlacements += result.candidatePlacements ?? 0;
    if (result.capped) capped += 1;
    if (result.score < min) min = result.score;
    if (result.score > max) max = result.score;
  }
  return {
    games: results.length,
    mean: stats.mean,
    variance: stats.count > 0 ? stats.m2 / stats.count : 0,
    standardDeviation: stats.count > 0 ? Math.sqrt(stats.m2 / stats.count) : 0,
    min: results.length ? min : 0,
    max: results.length ? max : 0,
    averagePieces: results.length ? totalPieces / results.length : 0,
    totalPieces,
    totalCandidatePlacements,
    capped,
    truncated: capped > 0,
    elapsedSeconds,
    gamesPerSecond: elapsedSeconds > 0 ? results.length / elapsedSeconds : 0,
    piecesPerSecond: elapsedSeconds > 0 ? totalPieces / elapsedSeconds : 0,
    candidatesPerSecond: elapsedSeconds > 0 ? totalCandidatePlacements / elapsedSeconds : 0,
  };
}

export function resultsToCsv(results) {
  const lines = ["gameIndex,seed,score,lines,pieces,candidatePlacements,capped,elapsedMs"];
  for (const result of results) {
    lines.push(
      [
        result.gameIndex,
        result.seed,
        result.score,
        result.lines,
        result.pieces,
        result.candidatePlacements ?? 0,
        result.capped ? 1 : 0,
        result.elapsedMs.toFixed(3),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function createWelfordStats() {
  return { count: 0, mean: 0, m2: 0 };
}

export function addWelford(stats, value) {
  stats.count += 1;
  const delta = value - stats.mean;
  stats.mean += delta / stats.count;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
}
