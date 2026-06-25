import { existsSync, readFileSync } from "node:fs";
import { DT10_WEIGHTS, enumeratePlacements, getDt10Features, scoreFeatures, TetrisAI } from "../src/ai.js";
import {
  applyPlacementMask,
  boardToRows,
  createMaskSearchWork,
  evaluateDt10Mask,
  getDropYMask,
  getRotationData,
  getXData,
  playFastTetrisGame,
  searchDepth1Dt10Mask,
} from "../src/fastTetris.js";
import { applyPlacement, TetrisGame } from "../src/tetrisCore.js";

const candidateTarget = Math.max(100000, Number(process.argv[2] ?? 100000));
const featureKeys = [
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

await testCandidates(candidateTarget);
testParityBefore();

console.log(`Fast/reference tests passed: ${candidateTarget} candidate checks plus parity-before.`);

async function testCandidates(target) {
  const ai = new TetrisAI({ mode: "dt10" });
  const rows = new Uint16Array(10);
  const expectedRows = new Uint16Array(10);
  const searchWork = createMaskSearchWork();
  let checked = 0;
  let gameIndex = 0;
  let game = createReferenceGame(gameIndex);

  while (checked < target) {
    if (game.status !== "running") {
      gameIndex += 1;
      game = createReferenceGame(gameIndex);
      continue;
    }

    const state = game.getState();
    const type = state.current.type;
    boardToRows(state.board, rows);
    const refPlacements = enumeratePlacements(state.board, type);
    const fastMove = {};
    const fastFound = searchDepth1Dt10Mask(rows, type, fastMove, searchWork);
    const refMove = ai.findBestMove(state, { mode: "dt10" });
    if (Boolean(refMove) !== fastFound) fail("best found mismatch", { seed: game.seed, type });
    if (refMove) {
      assertEqual(fastMove.rotation, refMove.rotation, "best.rotation");
      assertEqual(fastMove.x, refMove.x, "best.x");
      assertClose(fastMove.eval, refMove.eval, "best.eval", 1e-9);
      compareFeatures(refMove.features, fastMove.features, "best.features");
    }

    for (let i = 0; i < refPlacements.length && checked < target; i += 1) {
      const placement = refPlacements[i];
      const refApplied = applyPlacement(state.board, type, placement.rotation, placement.x);
      const rotationData = getRotationDataForTest(type, placement.rotation);
      const xData = getXDataForTest(rotationData, placement.x);
      const y = getDropYForTest(rows, xData);
      assertEqual(y, placement.y, "placement.y");
      const applied = applyMaskForTest(rows, xData, y);
      assertEqual(applied.topOut, refApplied.topOut, "topOut");
      assertEqual(applied.lines, refApplied.lines, "lines");
      assertArrayEqual(applied.clearedRows, refApplied.clearedRows, "clearedRows");
      boardToRows(refApplied.board, expectedRows);
      assertRowsEqual(applied.rows, expectedRows, "afterstate rows");

      if (!refApplied.topOut) {
        const refFeatures = getDt10Features(refApplied.board, {
          type,
          rotation: placement.rotation,
          x: placement.x,
          y: placement.y,
          cells: placement.cells,
          clearedRows: refApplied.clearedRows,
          linesCleared: refApplied.lines,
        });
        const fastFeatures = evaluateDt10Mask(applied.rows, {
          type,
          rotation: placement.rotation,
          x: placement.x,
          y: placement.y,
          clearedRows: applied.clearedRows,
          linesCleared: applied.lines,
        });
        compareFeatures(refFeatures, fastFeatures, "candidate.features");
        assertClose(
          scoreFeatures(refFeatures, DT10_WEIGHTS),
          scoreFeatures(fastFeatures, DT10_WEIGHTS),
          "candidate.eval",
          1e-9,
        );
      }
      checked += 1;
    }

    if (!refMove) {
      game.status = "gameover";
    } else {
      game.applyMoveTarget(refMove);
    }
  }
}

function testParityBefore() {
  if (!existsSync("parity-before.json")) {
    console.warn("Skipping parity-before comparison because parity-before.json is missing.");
    return;
  }
  const parity = JSON.parse(readFileSync("parity-before.json", "utf8"));
  for (const expected of parity.gamesResult) {
    const actual = playFastTetrisGame({
      gameIndex: expected.gameIndex,
      seed: expected.seed,
      maxPieces: parity.maxPieces,
      recordActions: Boolean(expected.actions),
    });
    assertEqual(actual.score, expected.score, `parity score ${expected.seed}`);
    assertEqual(actual.pieces, expected.pieces, `parity pieces ${expected.seed}`);
    assertEqual(actual.lines, expected.lines, `parity lines ${expected.seed}`);
    assertEqual(actual.capped, expected.capped, `parity capped ${expected.seed}`);
    if (expected.actions) {
      assertEqual(actual.actions.length, expected.actions.length, `actions length ${expected.seed}`);
      for (let i = 0; i < expected.actions.length; i += 1) {
        assertEqual(actual.actions[i].type, expected.actions[i].type, `action type ${expected.seed}#${i}`);
        assertEqual(actual.actions[i].rotation, expected.actions[i].rotation, `action rotation ${expected.seed}#${i}`);
        assertEqual(actual.actions[i].x, expected.actions[i].x, `action x ${expected.seed}#${i}`);
      }
    }
  }
}

function createReferenceGame(index) {
  const game = new TetrisGame({ seed: `fast-reference-${index}` });
  game.start();
  return game;
}

function getRotationDataForTest(type, rotation) {
  return getRotationData(type, rotation);
}

function getXDataForTest(rotationData, x) {
  return getXData(rotationData, x);
}

function getDropYForTest(rows, xData) {
  return getDropYMask(rows, xData);
}

function applyMaskForTest(rows, xData, y) {
  const target = new Uint16Array(10);
  const clearedBuffer = new Int8Array(4);
  const result = applyPlacementMask(rows, xData, y, target, clearedBuffer);
  return {
    rows: target,
    lines: result.lines,
    topOut: result.topOut,
    clearedRows: Array.from(clearedBuffer.slice(0, result.lines)),
  };
}

function compareFeatures(expected, actual, label) {
  for (const key of featureKeys) {
    assertClose(actual[key], expected[key], `${label}.${key}`, 1e-9);
  }
}

function assertRowsEqual(actual, expected, label) {
  for (let y = 0; y < 10; y += 1) {
    if (actual[y] !== expected[y]) {
      fail(label, { row: y, expected: expected[y], actual: actual[y] });
    }
  }
}

function assertArrayEqual(actual, expected, label) {
  assertEqual(actual.length, expected.length, `${label}.length`);
  for (let i = 0; i < actual.length; i += 1) assertEqual(actual[i], expected[i], `${label}.${i}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(label, { expected, actual });
}

function assertClose(actual, expected, label, tolerance) {
  if (Math.abs(actual - expected) > tolerance) fail(label, { expected, actual, tolerance });
}

function fail(label, details) {
  throw new Error(`${label}: ${JSON.stringify(details, null, 2)}`);
}
