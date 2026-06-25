import { cloneBoard, collides, getDropY, placePieceOnBoard } from "./tetrisCore.js";
import { SHAPES, uniqueRotations } from "./tetrominoes.js";

export const AI_VERSION = "dt10-2013";
export const LEGACY_AI_VERSION = "legacy-v2";

export const DT10_WEIGHTS = {
  landingHeight: -2.18,
  erodedPieceCells: 2.42,
  rowTransitions: -2.17,
  columnTransitions: -3.31,
  holes: 0.95,
  boardWells: -2.22,
  holeDepth: -0.81,
  rowsWithHoles: -9.65,
  diversity: 1.27,
};

export const LEGACY_V2_WEIGHTS = {
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

export const DEFAULT_WEIGHTS = DT10_WEIGHTS;

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function addProfile(profile, key, value) {
  if (profile) profile[key] = (profile[key] ?? 0) + value;
}

export function enumeratePlacements(board, type) {
  if (!type) return [];
  const width = board[0].length;
  const result = [];
  for (const rotation of uniqueRotations(type)) {
    for (let x = -2; x < width + 2; x += 1) {
      const y = getDropY(board, type, rotation, x);
      if (y == null) continue;
      if (collides(board, type, rotation, x, y)) continue;
      const cells = SHAPES[type][rotation].map(([dx, dy]) => [x + dx, y + dy]);
      if (cells.every(([cx]) => cx >= 0 && cx < width)) {
        result.push({ type, rotation, x, y, cells });
      }
    }
  }
  return result;
}

function columnHeights(board) {
  const height = board.length;
  const width = board[0].length;
  const heights = Array(width).fill(0);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (board[y][x]) {
        heights[x] = height - y;
        break;
      }
    }
  }
  return heights;
}

function isFilled(board, x, y) {
  if (x < 0 || x >= board[0].length) return true;
  if (y >= board.length) return true;
  if (y < 0) return false;
  return Boolean(board[y][x]);
}

export function getDt10Features(board, placementInfo) {
  const height = board.length;
  const width = board[0].length;
  const type = placementInfo?.type;
  const rotation = placementInfo?.rotation ?? 0;
  const placementY = placementInfo?.y ?? 0;
  const shape = type ? SHAPES[type][rotation % 4] : [];
  const minDy = shape.length ? Math.min(...shape.map(([, dy]) => dy)) : 0;
  const maxDy = shape.length ? Math.max(...shape.map(([, dy]) => dy)) : 0;
  const lowestBoardY = placementY + maxDy;
  const bottomHeight = height - 1 - lowestBoardY;
  const landingHeight = bottomHeight + (maxDy - minDy) / 2;

  const linesCleared = placementInfo?.linesCleared ?? 0;
  const clearedRows = new Set(placementInfo?.clearedRows ?? []);
  const pieceCells = placementInfo?.cells ?? [];
  const erodedPieceCells =
    linesCleared * pieceCells.filter(([, y]) => clearedRows.has(y)).length;

  let rowTransitions = 0;
  for (let y = 0; y < height; y += 1) {
    let previousFilled = true;
    for (let x = 0; x < width; x += 1) {
      const filled = Boolean(board[y][x]);
      if (filled !== previousFilled) rowTransitions += 1;
      previousFilled = filled;
    }
    if (!previousFilled) rowTransitions += 1;
  }

  let columnTransitions = 0;
  for (let x = 0; x < width; x += 1) {
    let previousFilled = false;
    for (let y = 0; y < height; y += 1) {
      const filled = Boolean(board[y][x]);
      if (filled !== previousFilled) columnTransitions += 1;
      previousFilled = filled;
    }
    if (!previousFilled) columnTransitions += 1;
  }

  const holeCells = [];
  const rowsWithHoles = new Set();
  let holeDepth = 0;
  for (let x = 0; x < width; x += 1) {
    let filledAbove = 0;
    for (let y = 0; y < height; y += 1) {
      if (board[y][x]) {
        filledAbove += 1;
      } else if (filledAbove > 0) {
        holeCells.push([x, y]);
        rowsWithHoles.add(y);
        holeDepth += filledAbove;
      }
    }
  }

  let boardWells = 0;
  for (let x = 0; x < width; x += 1) {
    let wellDepth = 0;
    for (let y = 0; y < height; y += 1) {
      const isWellCell =
        !board[y][x] && isFilled(board, x - 1, y) && isFilled(board, x + 1, y);
      if (isWellCell) {
        wellDepth += 1;
        boardWells += wellDepth;
      } else {
        wellDepth = 0;
      }
    }
  }

  const heights = columnHeights(board);
  const heightDiffs = new Set();
  for (let x = 0; x < width - 1; x += 1) {
    const diff = heights[x] - heights[x + 1];
    if (diff >= -2 && diff <= 2) heightDiffs.add(diff);
  }

  return {
    landingHeight,
    erodedPieceCells,
    rowTransitions,
    columnTransitions,
    holes: holeCells.length,
    boardWells,
    holeDepth,
    rowsWithHoles: rowsWithHoles.size,
    diversity: heightDiffs.size,
  };
}

export function getLegacyFeatures(board, placementInfo = {}) {
  const height = board.length;
  const width = board[0].length;
  const heights = columnHeights(board);
  const aggregateHeight = heights.reduce((sum, value) => sum + value, 0);
  const maxHeight = Math.max(...heights);
  let holes = 0;
  let columnTransitions = 0;
  let rowTransitions = 0;
  let wells = 0;
  let holeDepth = 0;
  const rowsWithHoles = new Set();

  for (let x = 0; x < width; x += 1) {
    let blockSeen = false;
    let previousFilled = true;
    for (let y = 0; y < height; y += 1) {
      const filled = Boolean(board[y][x]);
      if (filled) blockSeen = true;
      else if (blockSeen) {
        holes += 1;
        rowsWithHoles.add(y);
        for (let above = y - 1; above >= 0; above -= 1) {
          if (board[above][x]) {
            holeDepth += y - above;
            break;
          }
        }
      }
      if (filled !== previousFilled) columnTransitions += 1;
      previousFilled = filled;
    }
    if (!previousFilled) columnTransitions += 1;
  }

  for (let y = 0; y < height; y += 1) {
    let previousFilled = true;
    for (let x = 0; x < width; x += 1) {
      const filled = Boolean(board[y][x]);
      if (filled !== previousFilled) rowTransitions += 1;
      previousFilled = filled;
    }
    if (!previousFilled) rowTransitions += 1;
  }

  for (let x = 0; x < width; x += 1) {
    const left = x === 0 ? height : heights[x - 1];
    const right = x === width - 1 ? height : heights[x + 1];
    const depth = Math.max(0, Math.min(left, right) - heights[x]);
    wells += (depth * (depth + 1)) / 2;
  }

  let bumpiness = 0;
  for (let x = 0; x < width - 1; x += 1) {
    bumpiness += Math.abs(heights[x] - heights[x + 1]);
  }

  const heightDiffs = new Set();
  for (let x = 0; x < width - 1; x += 1) {
    heightDiffs.add(heights[x] - heights[x + 1]);
  }

  const visibleCells = placementInfo.cells?.filter(([, y]) => y >= 0) ?? [];
  const landingHeight =
    visibleCells.length > 0
      ? height - visibleCells.reduce((sum, [, y]) => sum + y, 0) / visibleCells.length
      : 0;
  const clearedRows = new Set(placementInfo.clearedRows ?? []);
  const linesCleared = placementInfo.linesCleared ?? 0;
  const erodedPieceCells =
    linesCleared * visibleCells.filter(([, y]) => clearedRows.has(y)).length;

  return {
    aggregateHeight,
    completeLines: linesCleared,
    landingHeight,
    erodedPieceCells,
    holes,
    bumpiness,
    wells,
    holeDepth,
    rowsWithHoles: rowsWithHoles.size,
    diversity: heightDiffs.size,
    rowTransitions,
    columnTransitions,
    maxHeight,
  };
}

export function evaluateBoard(board, linesCleared = 0, placementInfo = null) {
  return getDt10Features(board, {
    ...placementInfo,
    linesCleared,
  });
}

export function scoreFeatures(features, weights = DT10_WEIGHTS) {
  return Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + (features[key] ?? 0) * weight;
  }, 0);
}

export class TetrisAI {
  constructor(options = {}) {
    this.mode = options.mode ?? "dt10";
    this.weights = {
      ...(this.mode === "legacy-v2" ? LEGACY_V2_WEIGHTS : DT10_WEIGHTS),
      ...(options.weights ?? {}),
    };
  }

  findBestMove(state, options = {}) {
    const profile = options.profile;
    const board = cloneBoard(state.board);
    const current = typeof state.current === "string" ? { type: state.current } : state.current;
    const type = current?.type;
    if (!type) return null;
    const mode = options.mode ?? this.mode;
    const result =
      mode === "legacy-v2"
        ? this.searchLegacy(board, type, profile)
        : this.searchDt10(board, type, profile);
    if (!result) return null;
    return {
      type: "move",
      x: result.placement.x,
      rotation: result.placement.rotation,
      y: result.placement.y,
      score: result.score,
      eval: result.score,
      features: result.features,
      actions: buildActionList(current, result.placement),
      source: mode === "legacy-v2" ? LEGACY_AI_VERSION : AI_VERSION,
      aiVersion: mode === "legacy-v2" ? LEGACY_AI_VERSION : AI_VERSION,
    };
  }

  searchDt10(board, type, profile = null) {
    let best = null;
    const enumerateStartedAt = nowMs();
    const placements = enumeratePlacements(board, type);
    addProfile(profile, "enumerateMs", nowMs() - enumerateStartedAt);
    addProfile(profile, "candidatePlacements", placements.length);
    for (const placement of placements) {
      const applyStartedAt = nowMs();
      const applied = placePieceOnBoard(board, type, placement.rotation, placement.x, placement.y);
      addProfile(profile, "applyPlacementMs", nowMs() - applyStartedAt);
      if (!applied || applied.topOut) continue;
      const featuresStartedAt = nowMs();
      const features = getDt10Features(applied.board, {
        type,
        rotation: placement.rotation,
        x: placement.x,
        y: placement.y,
        cells: placement.cells,
        clearedRows: applied.clearedRows,
        linesCleared: applied.lines,
      });
      addProfile(profile, "featuresMs", nowMs() - featuresStartedAt);
      const score = scoreFeatures(features, DT10_WEIGHTS);
      if (isBetterCandidate(best, placement, score)) {
        best = { placement, score, features };
      }
    }
    return best;
  }

  searchLegacy(board, type, profile = null) {
    let best = null;
    const enumerateStartedAt = nowMs();
    const placements = enumeratePlacements(board, type);
    addProfile(profile, "enumerateMs", nowMs() - enumerateStartedAt);
    addProfile(profile, "candidatePlacements", placements.length);
    for (const placement of placements) {
      const applyStartedAt = nowMs();
      const applied = placePieceOnBoard(board, type, placement.rotation, placement.x, placement.y);
      addProfile(profile, "applyPlacementMs", nowMs() - applyStartedAt);
      if (!applied) continue;
      const featuresStartedAt = nowMs();
      const features = getLegacyFeatures(applied.board, {
        cells: placement.cells,
        clearedRows: applied.clearedRows,
        linesCleared: applied.lines,
      });
      addProfile(profile, "featuresMs", nowMs() - featuresStartedAt);
      const score = scoreFeatures(features, LEGACY_V2_WEIGHTS);
      if (isBetterCandidate(best, placement, score)) {
        best = { placement, score, features };
      }
    }
    return best;
  }
}

function isBetterCandidate(best, placement, score) {
  if (!best) return true;
  if (score > best.score) return true;
  if (score < best.score) return false;
  if (placement.rotation !== best.placement.rotation) {
    return placement.rotation < best.placement.rotation;
  }
  return placement.x < best.placement.x;
}

export function buildActionList(current, placement) {
  const actions = [];
  const rotationSteps = (placement.rotation - (current.rotation ?? 0) + 4) % 4;
  for (let i = 0; i < rotationSteps; i += 1) actions.push("rotateCW");
  const dx = placement.x - (current.x ?? 0);
  const horizontal = dx > 0 ? "right" : "left";
  for (let i = 0; i < Math.abs(dx); i += 1) actions.push(horizontal);
  actions.push("hardDrop");
  return actions;
}
