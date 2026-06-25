import { TetrisAI } from "../src/ai.js";
import { applyPlacement, collides, createEmptyBoard } from "../src/tetrisCore.js";
import { PIECE_TYPES } from "../src/tetrominoes.js";
import { SeededRandom } from "../src/rng.js";

const config = {
  generations: Number(process.argv[2] ?? 8),
  population: Number(process.argv[3] ?? 32),
  eliteCount: Number(process.argv[4] ?? 6),
  gamesPerCandidate: Number(process.argv[5] ?? 12),
  maxPieces: Number(process.argv[6] ?? 1600),
};

const featureSigns = {
  landingHeight: -1,
  erodedPieceCells: 1,
  completeLines: 1,
  rowTransitions: -1,
  columnTransitions: -1,
  holes: -1,
  wells: -1,
  holeDepth: -1,
  rowsWithHoles: -1,
  diversity: 1,
  maxHeight: -1,
  aggregateHeight: -1,
  bumpiness: -1,
};

const baseWeights = {
  landingHeight: -6.829161581507131,
  erodedPieceCells: 1.2625699276081392,
  completeLines: 2.2516357547538375,
  rowTransitions: -2.234822618376413,
  columnTransitions: -1.2755671156491482,
  holes: -9.753739400223699,
  wells: -3.0875915164929117,
  holeDepth: -0.877042170838884,
  rowsWithHoles: -17.571195833107563,
  diversity: 1.5115395911374212,
  maxHeight: -3.0540182667701594,
  aggregateHeight: -0.6847023989376868,
  bumpiness: -0.7577483881773939,
};

const features = Object.keys(featureSigns);
let mean = features.map((feature) => Math.log(Math.abs(baseWeights[feature] ?? 1)));
let std = features.map(() => 1.2);
let globalBest = null;

for (let generation = 1; generation <= config.generations; generation += 1) {
  const seeds = Array.from(
    { length: config.gamesPerCandidate },
    (_, i) => `cem-g${generation}-game-${i}`,
  );
  const candidates = [];
  candidates.push({ weights: baseWeights, vector: mean });
  while (candidates.length < config.population) {
    const vector = mean.map((value, index) => value + gaussian() * std[index]);
    candidates.push({ vector, weights: vectorToWeights(vector) });
  }

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      result: evaluateWeights(candidate.weights, seeds, config.maxPieces),
    }))
    .sort((a, b) => b.result.mean - a.result.mean);

  const elite = scored.slice(0, config.eliteCount);
  if (!globalBest || scored[0].result.mean > globalBest.result.mean) {
    globalBest = scored[0];
  }

  mean = features.map((_, index) => average(elite.map((candidate) => candidate.vector[index])));
  std = features.map((_, index) => {
    const values = elite.map((candidate) => candidate.vector[index]);
    return Math.max(0.18, Math.sqrt(average(values.map((value) => (value - mean[index]) ** 2))));
  });

  console.log(
    JSON.stringify({
      generation,
      best: scored[0].result,
      eliteMean: average(elite.map((candidate) => candidate.result.mean)),
      weights: scored[0].weights,
    }),
  );
}

const verifySeeds = Array.from({ length: 100 }, (_, i) => `cem-verify-${i}`);
const verification = evaluateWeights(globalBest.weights, verifySeeds, 5000);

console.log("\nBEST_WEIGHTS");
console.log(JSON.stringify(globalBest.weights, null, 2));
console.log("\nVERIFICATION");
console.log(JSON.stringify(verification, null, 2));

function vectorToWeights(vector) {
  return Object.fromEntries(
    features.map((feature, index) => [
      feature,
      featureSigns[feature] * Math.exp(clamp(vector[index], -7, 5)),
    ]),
  );
}

function evaluateWeights(weights, seeds, maxPieces) {
  const ai = new TetrisAI({ weights });
  const scores = [];
  const pieces = [];
  for (const seed of seeds) {
    const result = playFast(ai, seed, maxPieces);
    scores.push(result.score);
    pieces.push(result.pieces);
  }
  const mean = average(scores);
  return {
    mean,
    variance: average(scores.map((score) => (score - mean) ** 2)),
    min: Math.min(...scores),
    max: Math.max(...scores),
    averagePieces: average(pieces),
  };
}

function playFast(ai, seed, maxPieces) {
  const rng = new SeededRandom(seed);
  let board = createEmptyBoard(10, 10);
  let queue = refillQueue(rng, []);
  let current = { type: queue.shift(), x: 3, y: -2, rotation: 0 };
  queue = refillQueue(rng, queue);
  let score = 0;
  let pieces = 0;

  while (pieces < maxPieces) {
    if (collides(board, current.type, 0, 3, -2)) break;
    const move = ai.findBestMove(
      { board, current, next: queue.slice(0, 5) },
      { depth: 1 },
    );
    if (!move) break;
    const applied = applyPlacement(board, current.type, move.rotation, move.x);
    if (!applied) break;
    board = applied.board;
    score += applied.lines;
    pieces += 1;
    if (applied.topOut) break;
    current = { type: queue.shift(), x: 3, y: -2, rotation: 0 };
    queue = refillQueue(rng, queue);
  }

  return { score, pieces };
}

function refillQueue(rng, queue) {
  while (queue.length < 5) {
    queue.push(PIECE_TYPES[rng.int(PIECE_TYPES.length)]);
  }
  return queue;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
