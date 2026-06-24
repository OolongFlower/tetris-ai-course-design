import { applyPlacement, cloneBoard, collides, getDropY } from "./tetrisCore.js";
import { SHAPES, uniqueRotations } from "./tetrominoes.js";

export const AI_VERSION = "10x10-tuned-v2";

export const DEFAULT_WEIGHTS = {
  landingHeight: -2,
  erodedPieceCells: 8,
  completeLines: 3,
  rowTransitions: -1.2,
  columnTransitions: -2.5,
  holes: -10,
  wells: -1,
  maxHeight: -4,
  aggregateHeight: -0.2,
  bumpiness: -0.4,
};

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

export function evaluateBoard(board, linesCleared = 0, placementInfo = null) {
  const height = board.length;
  const width = board[0].length;
  const heights = columnHeights(board);
  const aggregateHeight = heights.reduce((sum, value) => sum + value, 0);
  const maxHeight = Math.max(...heights);
  let holes = 0;
  let columnTransitions = 0;
  let rowTransitions = 0;
  let wells = 0;

  for (let x = 0; x < width; x += 1) {
    let blockSeen = false;
    let previousFilled = true;
    for (let y = 0; y < height; y += 1) {
      const filled = Boolean(board[y][x]);
      if (filled) blockSeen = true;
      else if (blockSeen) holes += 1;
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

  const visibleCells = placementInfo?.cells?.filter(([, y]) => y >= 0) ?? [];
  const landingHeight =
    visibleCells.length > 0
      ? height - visibleCells.reduce((sum, [, y]) => sum + y, 0) / visibleCells.length
      : 0;
  const clearedRows = new Set(placementInfo?.clearedRows ?? []);
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
    rowTransitions,
    columnTransitions,
    maxHeight,
  };
}

export function scoreFeatures(features, weights = DEFAULT_WEIGHTS) {
  return Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + (features[key] ?? 0) * weight;
  }, 0);
}

function mergeFeatures(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
}

export class TetrisAI {
  constructor(options = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
    this.discount = options.discount ?? 0.72;
  }

  findBestMove(state, options = {}) {
    const board = cloneBoard(state.board);
    const current = typeof state.current === "string" ? { type: state.current } : state.current;
    const type = current?.type;
    if (!type) return null;
    const next = options.next ?? state.next ?? [];
    const depth = Math.max(1, Number(options.depth ?? 1));
    const result = this.search(board, type, next, depth);
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
      source: depth > 1 ? `heuristic-depth-${depth}` : "heuristic-depth-1",
    };
  }

  search(board, type, nextPieces = [], depth = 1) {
    const placements = enumeratePlacements(board, type);
    let best = null;
    for (const placement of placements) {
      const applied = applyPlacement(board, type, placement.rotation, placement.x);
      if (!applied) continue;
      const features = evaluateBoard(applied.board, applied.lines, {
        cells: placement.cells,
        clearedRows: applied.clearedRows,
      });
      let score = scoreFeatures(features, this.weights);
      let combinedFeatures = features;
      if (depth > 1 && nextPieces.length > 0) {
        const child = this.search(applied.board, nextPieces[0], nextPieces.slice(1), depth - 1);
        if (child) {
          score += child.score * this.discount;
          combinedFeatures = mergeFeatures(features, child.features);
        }
      }
      if (!best || score > best.score) {
        best = {
          placement,
          score,
          features: combinedFeatures,
        };
      }
    }
    return best;
  }
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
