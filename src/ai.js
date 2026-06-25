import { applyPlacement, cloneBoard, collides, getDropY } from "./tetrisCore.js";
import { SHAPES, uniqueRotations } from "./tetrominoes.js";

export const AI_VERSION = "10x10-lookahead-v3";

export const DEFAULT_WEIGHTS = {
  landingHeight: -2.8,
  erodedPieceCells: 2.2,
  completeLines: 1.65,
  rowTransitions: -2.4,
  columnTransitions: -2.1,
  holes: -14,
  wells: -1.6,
  maxHeight: -2.88,
  aggregateHeight: -0.2,
  bumpiness: -0.34,
};

// Per-move reward features describe the piece that was just placed, so when we
// look ahead they accumulate along the search path. The remaining (positional)
// features describe a resting board, so they are only meaningful for the final
// board reached at the end of the look-ahead. With a single ply both sets are
// scored on the same board, which is exactly the original greedy evaluation.
const PER_MOVE_FEATURES = ["landingHeight", "erodedPieceCells", "completeLines"];

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
  let aggregateHeight = 0;
  let maxHeight = 0;
  for (let x = 0; x < width; x += 1) {
    aggregateHeight += heights[x];
    if (heights[x] > maxHeight) maxHeight = heights[x];
  }
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

  let landingHeight = 0;
  let erodedPieceCells = 0;
  const cells = placementInfo?.cells;
  if (cells) {
    const clearedRows = placementInfo?.clearedRows;
    let visible = 0;
    let ySum = 0;
    let erodedCount = 0;
    for (let i = 0; i < cells.length; i += 1) {
      const cy = cells[i][1];
      if (cy < 0) continue;
      visible += 1;
      ySum += cy;
      if (linesCleared > 0 && clearedRows && clearedRows.includes(cy)) erodedCount += 1;
    }
    if (visible > 0) landingHeight = height - ySum / visible;
    erodedPieceCells = linesCleared * erodedCount;
  }

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

// A placement that locks part of the piece above the visible board is an
// imminent top-out: penalise it so heavily that the search avoids it whenever a
// survivable alternative exists.
const TOP_OUT_PENALTY = 1e6;

export class TetrisAI {
  constructor(options = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
    // Pre-split the weights so the hot search loop never touches Object.entries.
    this.perMoveWeights = PER_MOVE_FEATURES.map((key) => [key, this.weights[key] ?? 0]);
    this.positionalWeights = Object.entries(this.weights).filter(
      ([key]) => !PER_MOVE_FEATURES.includes(key),
    );
  }

  scorePerMove(features) {
    let sum = 0;
    for (let i = 0; i < this.perMoveWeights.length; i += 1) {
      const entry = this.perMoveWeights[i];
      sum += (features[entry[0]] ?? 0) * entry[1];
    }
    return sum;
  }

  scorePositional(features) {
    let sum = 0;
    for (let i = 0; i < this.positionalWeights.length; i += 1) {
      const entry = this.positionalWeights[i];
      sum += (features[entry[0]] ?? 0) * entry[1];
    }
    return sum;
  }

  findBestMove(state, options = {}) {
    const board = cloneBoard(state.board);
    const current = typeof state.current === "string" ? { type: state.current } : state.current;
    const type = current?.type;
    if (!type) return null;
    const next = options.next ?? state.next ?? [];
    const depth = Math.max(1, Number(options.depth ?? 1));
    // The look-ahead can only use as many future pieces as we actually know.
    const queue = [type, ...next].slice(0, depth);
    const result = this.search(board, queue, 0);
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

  // queue[index] is the piece to place at this level; deeper levels place the
  // following pieces. Returns the best achievable value for the sub-tree rooted
  // at `index`, together with the placement chosen for queue[index].
  search(board, queue, index) {
    const type = queue[index];
    const isLeaf = index === queue.length - 1;
    const placements = enumeratePlacements(board, type);
    let best = null;
    for (const placement of placements) {
      const applied = applyPlacement(board, type, placement.rotation, placement.x);
      if (!applied) continue;
      const features = evaluateBoard(applied.board, applied.lines, {
        cells: placement.cells,
        clearedRows: applied.clearedRows,
      });
      // Reward features of the piece we just placed accumulate down the path.
      let value = this.scorePerMove(features);
      if (applied.topOut) value -= TOP_OUT_PENALTY;
      if (isLeaf) {
        // Positional quality only matters for the board we actually stop on.
        value += this.scorePositional(features);
      } else {
        const child = this.search(applied.board, queue, index + 1);
        if (child) value += child.score;
        else value -= TOP_OUT_PENALTY;
      }
      if (!best || value > best.score) {
        best = { placement, score: value, features };
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
