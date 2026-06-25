import { enumeratePlacements } from "../src/ai.js";
import { applyPlacement, cloneBoard, TetrisGame } from "../src/tetrisCore.js";
import { SeededRandom } from "../src/rng.js";

const ACTIONS = 5000;
const rng = new SeededRandom("dt10-apply-consistency");

let gameIndex = 0;
let game = createGame(gameIndex);
let checked = 0;

while (checked < ACTIONS) {
  if (game.status !== "running") {
    gameIndex += 1;
    game = createGame(gameIndex);
    continue;
  }

  const state = game.getState();
  const legalPlacements = enumeratePlacements(state.board, state.current.type)
    .map((placement) => ({
      placement,
      applied: applyPlacement(state.board, state.current.type, placement.rotation, placement.x),
    }))
    .filter(({ applied }) => applied && !applied.topOut);

  if (legalPlacements.length === 0) {
    gameIndex += 1;
    game = createGame(gameIndex);
    continue;
  }

  const { placement, applied } = legalPlacements[rng.int(legalPlacements.length)];
  const previousBoard = cloneBoard(game.board);
  const previousLines = game.lines;
  const previousScore = game.score;
  const previousSeed = game.seed;
  const previousPiece = state.current.type;

  const ok = game.applyMoveTarget({
    rotation: placement.rotation,
    x: placement.x,
  });
  if (!ok) {
    fail("applyMoveTarget returned false", previousSeed, previousPiece, placement);
  }

  if (!boardsEqual(game.board, applied.board)) {
    fail("board mismatch", previousSeed, previousPiece, placement, previousBoard, applied.board, game.board);
  }
  if (game.lines !== previousLines + applied.lines) {
    fail("lines mismatch", previousSeed, previousPiece, placement);
  }
  if (game.score !== previousScore + applied.lines) {
    fail("score mismatch", previousSeed, previousPiece, placement);
  }

  checked += 1;
}

console.log(`applyPlacement/applyMoveTarget consistency passed: ${checked} actions.`);

function createGame(index) {
  const next = new TetrisGame({ seed: `dt10-consistency-${index}` });
  next.start();
  return next;
}

function boardsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fail(reason, seed, piece, placement, before = null, predicted = null, actual = null) {
  const details = {
    reason,
    seed,
    piece,
    rotation: placement.rotation,
    x: placement.x,
    y: placement.y,
    before,
    predicted,
    actual,
  };
  throw new Error(JSON.stringify(details, null, 2));
}
