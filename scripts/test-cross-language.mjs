import { spawnSync } from "node:child_process";
import { TetrisAI } from "../src/ai.js";
import { createEmptyBoard } from "../src/tetrisCore.js";

const FEATURE_KEYS = [
  "landingHeight",
  "erodedPieceCells",
  "rowTransitions",
  "columnTransitions",
  "holes",
  "boardWells",
  "holeDepth",
  "rowsWithHoles",
  "diversity",
];

const board = createEmptyBoard(10, 10);
for (const [x, ys] of [
  [0, [8, 9]],
  [1, [7, 8, 9]],
  [2, [9]],
  [3, [6, 8, 9]],
  [4, [8, 9]],
  [5, [5, 6, 9]],
  [6, [7, 8, 9]],
  [7, [9]],
  [8, [8, 9]],
  [9, [6, 7, 8, 9]],
]) {
  for (const y of ys) board[y][x] = "X";
}

const state = {
  type: "state",
  seq: 1001,
  width: 10,
  height: 10,
  board,
  current: { type: "T", x: 3, y: -2, rotation: 0 },
  next: ["I", "O", "S", "Z", "L"],
  score: 0,
  lines: 0,
  level: 1,
  pieces: 0,
  status: "running",
  seed: "cross-language-vector",
  turn: 1,
};

const jsMove = new TetrisAI({ mode: "dt10" }).findBestMove(state, { mode: "dt10" });
const pyMove = runPythonVector(state);

assertEqual(pyMove.rotation, jsMove.rotation, "rotation");
assertEqual(pyMove.x, jsMove.x, "x");
assertClose(pyMove.eval, jsMove.eval, "eval");
for (const key of FEATURE_KEYS) {
  assertClose(pyMove.features[key], jsMove.features[key], `features.${key}`);
}
assertEqual(pyMove.aiVersion, "dt10-2013", "aiVersion");

console.log("JS/Python DT-10 vector test passed.");

function runPythonVector(message) {
  const code = [
    "import json, sys",
    "import ai_server",
    "message = json.loads(sys.stdin.read())",
    "print(json.dumps(ai_server.choose_move(message), sort_keys=True))",
  ].join("\n");
  const result = spawnSync("python", ["-c", code], {
    input: JSON.stringify(message),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Python vector failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
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
