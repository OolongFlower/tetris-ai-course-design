import { TetrisAI } from "../src/ai.js";
import { TetrisGame } from "../src/tetrisCore.js";

const ai = new TetrisAI();
const results = [];

for (let i = 0; i < 5; i += 1) {
  const game = new TetrisGame({ seed: `smoke-${i}` });
  game.start();
  let steps = 0;
  while (game.status === "running" && steps < 600) {
    const move = ai.findBestMove(game.getState(), { depth: 1 });
    if (!move) throw new Error("AI returned no move");
    game.applyMoveTarget(move);
    steps += 1;
  }
  results.push({ seed: game.seed, lines: game.lines, score: game.score, pieces: game.pieces });
}

console.table(results);
console.log("Smoke test passed.");
