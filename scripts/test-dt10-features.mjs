import { getDt10Features } from "../src/ai.js";
import { applyPlacement, createEmptyBoard } from "../src/tetrisCore.js";
import { SHAPES } from "../src/tetrominoes.js";

const WIDTH = 10;
const HEIGHT = 10;
const FILL = "X";

function emptyBoard() {
  return createEmptyBoard(WIDTH, HEIGHT);
}

function placementInfo(type = "O", rotation = 0, x = 3, y = 8, extra = {}) {
  return {
    type,
    rotation,
    x,
    y,
    cells: SHAPES[type][rotation].map(([dx, dy]) => [x + dx, y + dy]),
    clearedRows: [],
    linesCleared: 0,
    ...extra,
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertClose(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertFeature(board, info, expected, label) {
  const features = getDt10Features(board, info);
  for (const [key, value] of Object.entries(expected)) {
    if (Number.isInteger(value)) assertEqual(features[key], value, `${label}.${key}`);
    else assertClose(features[key], value, `${label}.${key}`);
  }
}

function boardFromHeights(heights) {
  const board = emptyBoard();
  heights.forEach((height, x) => {
    for (let y = HEIGHT - height; y < HEIGHT; y += 1) {
      board[y][x] = FILL;
    }
  });
  return board;
}

function cellsFor(type, rotation, x, y) {
  return SHAPES[type][rotation].map(([dx, dy]) => [x + dx, y + dy]);
}

{
  const board = emptyBoard();
  assertFeature(
    board,
    placementInfo("O", 0, 3, 8),
    {
      landingHeight: 0.5,
      erodedPieceCells: 0,
      rowTransitions: 20,
      columnTransitions: 10,
      holes: 0,
      boardWells: 0,
      holeDepth: 0,
      rowsWithHoles: 0,
      diversity: 1,
    },
    "empty board",
  );
}

{
  const board = emptyBoard();
  const applied = applyPlacement(board, "O", 0, 3);
  assertFeature(
    applied.board,
    placementInfo("O", 0, 3, applied.y, {
      cells: cellsFor("O", 0, 3, applied.y),
      clearedRows: applied.clearedRows,
      linesCleared: applied.lines,
    }),
    { landingHeight: 0.5, erodedPieceCells: 0 },
    "single flat piece",
  );
}

{
  const board = emptyBoard();
  board[0][4] = FILL;
  for (let y = 2; y < HEIGHT; y += 1) board[y][4] = FILL;
  assertFeature(
    board,
    placementInfo(),
    { holes: 1, holeDepth: 1, rowsWithHoles: 1 },
    "one hole",
  );
}

{
  const board = emptyBoard();
  for (const x of [3, 6]) {
    board[0][x] = FILL;
    for (let y = 2; y < HEIGHT; y += 1) board[y][x] = FILL;
  }
  assertFeature(
    board,
    placementInfo(),
    { holes: 2, holeDepth: 2, rowsWithHoles: 1 },
    "same row two holes",
  );
}

for (const depth of [1, 2, 3]) {
  const board = emptyBoard();
  for (let y = HEIGHT - depth; y < HEIGHT; y += 1) {
    board[y][0] = FILL;
    board[y][2] = FILL;
  }
  assertFeature(
    board,
    placementInfo(),
    { boardWells: (depth * (depth + 1)) / 2 },
    `well depth ${depth}`,
  );
}

{
  const board = boardFromHeights([0, 3, 5, 5, 3, 6, 2, 2, 2, 2]);
  assertFeature(board, placementInfo(), { diversity: 3 }, "diversity filtered diffs");
}

{
  const board = emptyBoard();
  for (let x = 0; x < WIDTH; x += 1) board[9][x] = FILL;
  board[9][4] = 0;
  const applied = applyPlacement(board, "I", 1, 2);
  assertEqual(applied.lines, 1, "one-line clear.lines");
  assertFeature(
    applied.board,
    placementInfo("I", 1, 2, applied.y, {
      cells: cellsFor("I", 1, 2, applied.y),
      clearedRows: applied.clearedRows,
      linesCleared: applied.lines,
    }),
    { erodedPieceCells: 1 },
    "one-line clear eroded cells",
  );
}

{
  const board = emptyBoard();
  for (let x = 0; x < WIDTH; x += 1) {
    board[8][x] = FILL;
    board[9][x] = FILL;
  }
  board[8][4] = 0;
  board[8][5] = 0;
  board[9][4] = 0;
  const applied = applyPlacement(board, "T", 1, 3);
  assertEqual(applied.lines, 2, "two-line clear.lines");
  assertFeature(
    applied.board,
    placementInfo("T", 1, 3, applied.y, {
      cells: cellsFor("T", 1, 3, applied.y),
      clearedRows: applied.clearedRows,
      linesCleared: applied.lines,
    }),
    { erodedPieceCells: 6 },
    "two-line clear three piece cells",
  );
}

console.log("DT-10 feature tests passed.");
