import { AI_VERSION, TetrisAI } from "../src/ai.js";
import { TetrisGame } from "../src/tetrisCore.js";

const games = Number(process.argv[2] ?? 10000);
const maxPieces = Math.max(100000, Number(process.argv[3] ?? 100000));
const ai = new TetrisAI({ mode: "dt10" });
const scores = [];
const pieces = [];
let capped = 0;

const startedAt = Date.now();

for (let i = 0; i < games; i += 1) {
  const game = new TetrisGame({ seed: `benchmark-10x10-${i + 1}` });
  game.start();
  let steps = 0;
  while (game.status === "running" && steps < maxPieces) {
    const move = ai.findBestMove(game.getState(), { mode: "dt10" });
    if (!move) {
      game.status = "gameover";
      break;
    }
    if (!game.applyMoveTarget(move)) {
      game.status = "gameover";
      break;
    }
    steps += 1;
  }
  if (steps >= maxPieces) capped += 1;
  scores.push(game.score);
  pieces.push(game.pieces);

  if ((i + 1) % 1000 === 0) {
    console.log(`finished ${i + 1}/${games}`);
  }
}

const mean = average(scores);
const varScore = variance(scores);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

console.log(
  JSON.stringify(
    {
      games,
      aiVersion: AI_VERSION,
      rule: "10x10, uniform 7-piece random, 1 point per cleared line",
      mean,
      variance: varScore,
      standardDeviation: Math.sqrt(varScore),
      max: Math.max(...scores),
      min: Math.min(...scores),
      averagePieces: average(pieces),
      capped,
      truncated: capped > 0,
      elapsedSeconds: Number(elapsed),
    },
    null,
    2,
  ),
);

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  const meanValue = average(values);
  return average(values.map((value) => (value - meanValue) ** 2));
}
