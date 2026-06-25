import { AI_VERSION, DT10_WEIGHTS } from "./ai.js";
import { SeededRandom } from "./rng.js";
import { BOARD_HEIGHT, BOARD_WIDTH, PIECE_TYPES, SHAPES } from "./tetrominoes.js";

export const FULL_ROW_MASK = (1 << BOARD_WIDTH) - 1;
export const ROW_POPCOUNT = new Uint8Array(1 << BOARD_WIDTH);
export const ROW_TRANSITIONS = new Uint8Array(1 << BOARD_WIDTH);
export const ROW_FULL = new Uint8Array(1 << BOARD_WIDTH);
export const TRIANGULAR = new Uint8Array(BOARD_HEIGHT + 1);

for (let mask = 0; mask <= FULL_ROW_MASK; mask += 1) {
  let pop = 0;
  let transitions = 0;
  let previousFilled = 1;
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const filled = (mask >> x) & 1;
    pop += filled;
    if (filled !== previousFilled) transitions += 1;
    previousFilled = filled;
  }
  if (previousFilled === 0) transitions += 1;
  ROW_POPCOUNT[mask] = pop;
  ROW_TRANSITIONS[mask] = transitions;
  ROW_FULL[mask] = mask === FULL_ROW_MASK ? 1 : 0;
}

for (let i = 0; i < TRIANGULAR.length; i += 1) {
  TRIANGULAR[i] = (i * (i + 1)) / 2;
}

export const PIECE_ROTATIONS = precomputePieceRotations();

export function boardToRows(board, target = new Uint16Array(BOARD_HEIGHT)) {
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    let mask = 0;
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (board[y][x]) mask |= 1 << x;
    }
    target[y] = mask;
  }
  return target;
}

export function rowsToBoard(rows) {
  const board = Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(0));
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    const row = rows[y];
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      if (row & (1 << x)) board[y][x] = "X";
    }
  }
  return board;
}

export function collidesMask(rows, xData, y) {
  const masks = xData.rowMasks;
  for (let dy = 0; dy < masks.length; dy += 1) {
    const mask = masks[dy];
    if (mask === 0) continue;
    const py = y + dy;
    if (py >= BOARD_HEIGHT) return true;
    if (py >= 0 && (rows[py] & mask) !== 0) return true;
  }
  return false;
}

export function getDropYMask(rows, xData) {
  let y = -4;
  if (collidesMask(rows, xData, y)) return null;
  while (!collidesMask(rows, xData, y + 1)) y += 1;
  return y;
}

export function applyPlacementMask(sourceRows, xData, y, targetRows, clearedRows) {
  for (let row = 0; row < BOARD_HEIGHT; row += 1) targetRows[row] = sourceRows[row];

  let topOut = false;
  const masks = xData.rowMasks;
  for (let dy = 0; dy < masks.length; dy += 1) {
    const mask = masks[dy];
    if (mask === 0) continue;
    const py = y + dy;
    if (py < 0) {
      topOut = true;
    } else {
      targetRows[py] |= mask;
    }
  }

  let clearedCount = 0;
  for (let row = 0; row < BOARD_HEIGHT; row += 1) {
    if (ROW_FULL[targetRows[row]]) {
      clearedRows[clearedCount] = row;
      clearedCount += 1;
    }
  }

  if (clearedCount > 0) {
    let write = BOARD_HEIGHT - 1;
    for (let read = BOARD_HEIGHT - 1; read >= 0; read -= 1) {
      if (ROW_FULL[targetRows[read]]) continue;
      targetRows[write] = targetRows[read];
      write -= 1;
    }
    while (write >= 0) {
      targetRows[write] = 0;
      write -= 1;
    }
  }

  return { lines: clearedCount, topOut };
}

export function clearLinesMask(rows, targetRows = rows, clearedRows = new Int8Array(4)) {
  return applyPlacementMask(rows, EMPTY_X_DATA, 0, targetRows, clearedRows);
}

export function evaluateDt10MaskInto(
  rows,
  rotationData,
  xData,
  placementY,
  linesCleared,
  clearedRows,
  clearedCount,
  out,
) {
  const lowestBoardY = placementY + rotationData.maxY;
  const bottomHeight = BOARD_HEIGHT - 1 - lowestBoardY;
  const landingHeight = bottomHeight + rotationData.landingHalfSpan;

  let erodedPieceCells = 0;
  if (linesCleared > 0) {
    const rowCellCounts = xData.rowCellCounts;
    for (let i = 0; i < clearedCount; i += 1) {
      const localY = clearedRows[i] - placementY;
      if (localY >= 0 && localY < rowCellCounts.length) {
        erodedPieceCells += rowCellCounts[localY];
      }
    }
    erodedPieceCells *= linesCleared;
  }

  let rowTransitions = 0;
  for (let y = 0; y < BOARD_HEIGHT; y += 1) {
    rowTransitions += ROW_TRANSITIONS[rows[y]];
  }

  let columnTransitions = 0;
  let holes = 0;
  let holeDepth = 0;
  let holeRowsMask = 0;
  let previousHeight = 0;
  let diversityMask = 0;

  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const bit = 1 << x;
    let previousFilled = 0;
    let filledAbove = 0;
    let height = 0;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      const filled = (rows[y] & bit) === 0 ? 0 : 1;
      if (filled !== previousFilled) columnTransitions += 1;
      previousFilled = filled;
      if (filled) {
        filledAbove += 1;
        if (height === 0) height = BOARD_HEIGHT - y;
      } else if (filledAbove > 0) {
        holes += 1;
        holeDepth += filledAbove;
        holeRowsMask |= 1 << y;
      }
    }
    if (previousFilled === 0) columnTransitions += 1;

    if (x > 0) {
      const diff = previousHeight - height;
      if (diff >= -2 && diff <= 2) diversityMask |= 1 << (diff + 2);
    }
    previousHeight = height;
  }

  let boardWells = 0;
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const bit = 1 << x;
    const leftBit = x > 0 ? 1 << (x - 1) : 0;
    const rightBit = x < BOARD_WIDTH - 1 ? 1 << (x + 1) : 0;
    let wellDepth = 0;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      const row = rows[y];
      const empty = (row & bit) === 0;
      const leftFilled = x === 0 || (row & leftBit) !== 0;
      const rightFilled = x === BOARD_WIDTH - 1 || (row & rightBit) !== 0;
      if (empty && leftFilled && rightFilled) {
        wellDepth += 1;
        boardWells += wellDepth;
      } else {
        wellDepth = 0;
      }
    }
  }

  out.landingHeight = landingHeight;
  out.erodedPieceCells = erodedPieceCells;
  out.rowTransitions = rowTransitions;
  out.columnTransitions = columnTransitions;
  out.holes = holes;
  out.boardWells = boardWells;
  out.holeDepth = holeDepth;
  out.rowsWithHoles = ROW_POPCOUNT[holeRowsMask];
  out.diversity = ROW_POPCOUNT[diversityMask];
  out.eval =
    landingHeight * DT10_WEIGHTS.landingHeight +
    erodedPieceCells * DT10_WEIGHTS.erodedPieceCells +
    rowTransitions * DT10_WEIGHTS.rowTransitions +
    columnTransitions * DT10_WEIGHTS.columnTransitions +
    holes * DT10_WEIGHTS.holes +
    boardWells * DT10_WEIGHTS.boardWells +
    holeDepth * DT10_WEIGHTS.holeDepth +
    out.rowsWithHoles * DT10_WEIGHTS.rowsWithHoles +
    out.diversity * DT10_WEIGHTS.diversity;
  return out;
}

export function evaluateDt10Mask(rows, placementInfo) {
  const rotationData = getRotationData(placementInfo.type, placementInfo.rotation);
  const xData = getXData(rotationData, placementInfo.x);
  const out = {};
  evaluateDt10MaskInto(
    rows,
    rotationData,
    xData,
    placementInfo.y,
    placementInfo.linesCleared ?? 0,
    placementInfo.clearedRows ?? EMPTY_CLEARED_ROWS,
    placementInfo.clearedCount ?? (placementInfo.clearedRows?.length ?? 0),
    out,
  );
  delete out.eval;
  return out;
}

export function searchDepth1Dt10Mask(rows, type, out, work = createMaskSearchWork()) {
  const rotations = PIECE_ROTATIONS[type];
  let found = false;
  let bestScore = -Infinity;
  let bestRotation = 0;
  let bestX = 0;
  let bestY = 0;
  const featureScratch = work.features;
  const bestFeatures = work.bestFeatures;

  for (let rotationIndex = 0; rotationIndex < rotations.length; rotationIndex += 1) {
    const rotationData = rotations[rotationIndex];
    const xOptions = rotationData.xOptions;
    for (let xi = 0; xi < xOptions.length; xi += 1) {
      const xData = xOptions[xi];
      const y = getDropYMask(rows, xData);
      if (y == null) continue;
      work.candidatePlacements += 1;
      const applied = applyPlacementMask(rows, xData, y, work.afterRows, work.clearedRows);
      if (applied.topOut) continue;
      evaluateDt10MaskInto(
        work.afterRows,
        rotationData,
        xData,
        y,
        applied.lines,
        work.clearedRows,
        applied.lines,
        featureScratch,
      );
      const score = featureScratch.eval;
      if (
        !found ||
        score > bestScore ||
        (score === bestScore &&
          (rotationData.rotation < bestRotation ||
            (rotationData.rotation === bestRotation && xData.x < bestX)))
      ) {
        found = true;
        bestScore = score;
        bestRotation = rotationData.rotation;
        bestX = xData.x;
        bestY = y;
        copyFeatureValues(featureScratch, bestFeatures);
      }
    }
  }

  if (!found) return false;
  out.type = "move";
  out.x = bestX;
  out.y = bestY;
  out.rotation = bestRotation;
  out.score = bestScore;
  out.eval = bestScore;
  out.source = AI_VERSION;
  out.aiVersion = AI_VERSION;
  out.features = {
    landingHeight: bestFeatures.landingHeight,
    erodedPieceCells: bestFeatures.erodedPieceCells,
    rowTransitions: bestFeatures.rowTransitions,
    columnTransitions: bestFeatures.columnTransitions,
    holes: bestFeatures.holes,
    boardWells: bestFeatures.boardWells,
    holeDepth: bestFeatures.holeDepth,
    rowsWithHoles: bestFeatures.rowsWithHoles,
    diversity: bestFeatures.diversity,
  };
  return true;
}

export function createMaskSearchWork() {
  return {
    afterRows: new Uint16Array(BOARD_HEIGHT),
    clearedRows: new Int8Array(4),
    candidatePlacements: 0,
    features: createFeatureScratch(),
    bestFeatures: createFeatureScratch(),
  };
}

export function enumeratePlacementsMask(rows, type) {
  const result = [];
  const work = createMaskSearchWork();
  const rotations = PIECE_ROTATIONS[type];
  for (let rotationIndex = 0; rotationIndex < rotations.length; rotationIndex += 1) {
    const rotationData = rotations[rotationIndex];
    for (let xi = 0; xi < rotationData.xOptions.length; xi += 1) {
      const xData = rotationData.xOptions[xi];
      const y = getDropYMask(rows, xData);
      if (y == null) continue;
      const applied = applyPlacementMask(rows, xData, y, work.afterRows, work.clearedRows);
      result.push({
        type,
        rotation: rotationData.rotation,
        x: xData.x,
        y,
        topOut: applied.topOut,
        lines: applied.lines,
        clearedRows: Array.from(work.clearedRows.slice(0, applied.lines)),
        rows: Uint16Array.from(work.afterRows),
      });
    }
  }
  return result;
}

export class FastTetrisGame {
  constructor(options = {}) {
    this.maxPieces = options.maxPieces ?? 100000;
    this.rows = new Uint16Array(BOARD_HEIGHT);
    this.queue = new Array(5);
    this.work = createMaskSearchWork();
    this.move = {};
    this.reset(options.seed ?? Date.now());
  }

  reset(seed = Date.now()) {
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    for (let y = 0; y < BOARD_HEIGHT; y += 1) this.rows[y] = 0;
    for (let i = 0; i < 5; i += 1) this.queue[i] = PIECE_TYPES[this.rng.int(PIECE_TYPES.length)];
    this.queueHead = 0;
    this.current = null;
    this.score = 0;
    this.lines = 0;
    this.pieces = 0;
    this.status = "idle";
    this.turn = 0;
    this.candidatePlacements = 0;
    this.spawn();
  }

  start() {
    if (this.status === "idle") this.status = "running";
  }

  spawn() {
    const type = this.queue[this.queueHead];
    this.queue[this.queueHead] = PIECE_TYPES[this.rng.int(PIECE_TYPES.length)];
    this.queueHead = (this.queueHead + 1) % this.queue.length;
    this.current = type;
    this.turn += 1;
    const spawnRotation = getRotationData(type, 0);
    const spawnXData = getXData(spawnRotation, Math.floor(BOARD_WIDTH / 2) - 2);
    if (collidesMask(this.rows, spawnXData, -2)) this.status = "gameover";
  }

  step(recordActions = null) {
    if (this.status !== "running" || !this.current) return false;
    this.work.candidatePlacements = 0;
    const ok = searchDepth1Dt10Mask(this.rows, this.current, this.move, this.work);
    this.candidatePlacements += this.work.candidatePlacements;
    if (!ok) {
      this.status = "gameover";
      return false;
    }
    if (recordActions) {
      recordActions.push({
        type: this.current,
        rotation: this.move.rotation,
        x: this.move.x,
      });
    }
    const rotationData = getRotationData(this.current, this.move.rotation);
    const xData = getXData(rotationData, this.move.x);
    const applied = applyPlacementMask(this.rows, xData, this.move.y, this.rows, this.work.clearedRows);
    this.pieces += 1;
    if (applied.lines > 0) {
      this.lines += applied.lines;
      this.score += applied.lines;
    }
    if (applied.topOut) {
      this.status = "gameover";
      return true;
    }
    this.spawn();
    return true;
  }
}

export function playFastTetrisGame(options = {}) {
  const {
    gameIndex = 0,
    seed,
    maxPieces = 100000,
    recordActions = false,
  } = options;
  const game = new FastTetrisGame({ seed, maxPieces });
  const actions = recordActions ? [] : null;
  game.start();
  let steps = 0;
  while (game.status === "running" && steps < maxPieces) {
    game.step(actions);
    steps += 1;
  }
  return {
    gameIndex,
    seed,
    score: game.score,
    lines: game.lines,
    pieces: game.pieces,
    capped: steps >= maxPieces && game.status === "running",
    noMove: false,
    candidatePlacements: game.candidatePlacements,
    actions,
  };
}

export function getRotationData(type, rotation) {
  const rotations = PIECE_ROTATIONS[type];
  for (let i = 0; i < rotations.length; i += 1) {
    if (rotations[i].rotation === rotation) return rotations[i];
  }
  throw new Error(`Unknown rotation ${rotation} for ${type}`);
}

export function getXData(rotationData, x) {
  const offset = x - rotationData.minLegalX;
  const xData = rotationData.xOptions[offset];
  if (!xData || xData.x !== x) throw new Error(`Illegal x ${x} for ${rotationData.type}`);
  return xData;
}

function precomputePieceRotations() {
  const result = {};
  for (const type of PIECE_TYPES) {
    const seen = new Set();
    const rotations = [];
    const shapeList = SHAPES[type];
    for (let rotation = 0; rotation < shapeList.length; rotation += 1) {
      const cells = shapeList[rotation];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < cells.length; i += 1) {
        const x = cells[i][0];
        const y = cells[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const normalized = [];
      for (let i = 0; i < cells.length; i += 1) {
        normalized.push(`${cells[i][0] - minX},${cells[i][1] - minY}`);
      }
      normalized.sort();
      const key = normalized.join("|");
      if (seen.has(key)) continue;
      seen.add(key);

      const rowCount = maxY + 1;
      const minLegalX = -minX;
      const maxLegalX = BOARD_WIDTH - 1 - maxX;
      const rotationData = {
        type,
        rotation,
        cells,
        minX,
        maxX,
        minY,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        landingHalfSpan: (maxY - minY) / 2,
        minLegalX,
        maxLegalX,
        xOptions: [],
      };
      for (let x = minLegalX; x <= maxLegalX; x += 1) {
        const rowMasks = new Uint16Array(rowCount);
        const rowCellCounts = new Uint8Array(rowCount);
        for (let i = 0; i < cells.length; i += 1) {
          const px = x + cells[i][0];
          const py = cells[i][1];
          rowMasks[py] |= 1 << px;
          rowCellCounts[py] += 1;
        }
        rotationData.xOptions.push({ x, rowMasks, rowCellCounts });
      }
      rotations.push(rotationData);
    }
    result[type] = rotations;
  }
  return result;
}

function createFeatureScratch() {
  return {
    landingHeight: 0,
    erodedPieceCells: 0,
    rowTransitions: 0,
    columnTransitions: 0,
    holes: 0,
    boardWells: 0,
    holeDepth: 0,
    rowsWithHoles: 0,
    diversity: 0,
    eval: 0,
  };
}

function copyFeatureValues(source, target) {
  target.landingHeight = source.landingHeight;
  target.erodedPieceCells = source.erodedPieceCells;
  target.rowTransitions = source.rowTransitions;
  target.columnTransitions = source.columnTransitions;
  target.holes = source.holes;
  target.boardWells = source.boardWells;
  target.holeDepth = source.holeDepth;
  target.rowsWithHoles = source.rowsWithHoles;
  target.diversity = source.diversity;
  target.eval = source.eval;
}

const EMPTY_CLEARED_ROWS = new Int8Array(0);
const EMPTY_X_DATA = { rowMasks: new Uint16Array(0), rowCellCounts: new Uint8Array(0), x: 0 };
