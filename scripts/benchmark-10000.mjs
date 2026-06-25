import { TetrisAI } from "../src/ai.js";
import { TetrisGame } from "../src/tetrisCore.js";

const games = Number(process.argv[2] ?? 10000);
const maxPieces = Number(process.argv[3] ?? 20000);
// Search depth: 1 = greedy (fast, scales to 10000 games); 2+ looks ahead using
// the known next pieces and plays near-perfectly, but costs much more time.
const depth = Number(process.argv[4] ?? 1);
const ai = new TetrisAI();
const scores = [];
const pieces = [];
let capped = 0;

const startedAt = Date.now();

for (let i = 0; i < games; i += 1) {
  const game = new TetrisGame({ seed: `benchmark-10x10-${i + 1}` });
  game.start();
  let steps = 0;
  while (game.status === "running" && steps < maxPieces) {
    const move = ai.findBestMove(game.getState(), { depth });
    if (!move) break;
    game.applyMoveTarget(move);
    steps += 1;
  }
  if (steps >= maxPieces) capped += 1;
  scores.push(game.score);
  pieces.push(game.pieces);

  // Live progress: refresh a single line so you can watch how many games have
  // run, the running mean, elapsed time and a rough ETA.
  const done = i + 1;
  const runningMean = scores.reduce((sum, value) => sum + value, 0) / done;
  const sec = (Date.now() - startedAt) / 1000;
  const eta = done > 0 ? (sec / done) * (games - done) : 0;
  const line = `已完成 ${done}/${games}  均分 ${runningMean.toFixed(1)}  用时 ${sec.toFixed(0)}s  预计剩余 ${eta.toFixed(0)}s`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${line}   `);
  } else if (done === games || done % 1000 === 0) {
    console.log(line);
  }
}
if (process.stdout.isTTY) process.stdout.write("\n");

const mean = average(scores);
const varScore = variance(scores);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

console.log(
  JSON.stringify(
    {
      games,
      depth,
      rule: "10x10, uniform 7-piece random, 1 point per cleared line",
      mean,
      variance: varScore,
      max: Math.max(...scores),
      min: Math.min(...scores),
      averagePieces: average(pieces),
      capped,
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
