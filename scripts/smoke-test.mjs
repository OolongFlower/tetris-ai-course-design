import { TetrisAI } from "../src/ai.js";
import { TetrisGame } from "../src/tetrisCore.js";

const ai = new TetrisAI();
const results = [];

for (let i = 0; i < 5; i += 1) {
  const game = new TetrisGame({ seed: `smoke-${i}` });
  game.start();
  let steps = 0;
  while (game.status === "running" && steps < 600) {
    const move = ai.findBestMove(game.getState(), { mode: "dt10" });
    if (!move) throw new Error("AI returned no move");
    game.applyMoveTarget(move);
    steps += 1;
  }
  if (game.score !== game.lines) {
    throw new Error(`Score rule failed: score=${game.score}, lines=${game.lines}`);
  }
  results.push({ seed: game.seed, score: game.score, lines: game.lines, pieces: game.pieces });
}

console.table(results);
console.log("Smoke test passed.");
