import { BOARD_HEIGHT, BOARD_WIDTH, PIECE_TYPES, SHAPES } from "./tetrominoes.js";
import { SeededRandom } from "./rng.js";

const LINE_SCORES = [0, 100, 300, 500, 800];
const KICKS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
];

export function createEmptyBoard(width = BOARD_WIDTH, height = BOARD_HEIGHT) {
  return Array.from({ length: height }, () => Array(width).fill(0));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function normalizeCell(cell) {
  if (!cell) return 0;
  if (typeof cell === "string") return cell;
  if (typeof cell === "object" && cell.type) return cell.type;
  return cell;
}

export function collides(board, type, rotation, x, y) {
  const height = board.length;
  const width = board[0].length;
  for (const [dx, dy] of SHAPES[type][rotation % 4]) {
    const px = x + dx;
    const py = y + dy;
    if (px < 0 || px >= width || py >= height) return true;
    if (py >= 0 && normalizeCell(board[py][px])) return true;
  }
  return false;
}

export function getDropY(board, type, rotation, x) {
  let y = -4;
  if (collides(board, type, rotation, x, y)) return null;
  while (!collides(board, type, rotation, x, y + 1)) {
    y += 1;
  }
  return y;
}

export function clearCompletedLines(board) {
  const width = board[0].length;
  const remaining = board.filter((row) => !row.every(Boolean));
  const cleared = board.length - remaining.length;
  while (remaining.length < board.length) {
    remaining.unshift(Array(width).fill(0));
  }
  return { board: remaining, cleared };
}

export function placePieceOnBoard(board, type, rotation, x, y) {
  const next = cloneBoard(board);
  let topOut = false;
  for (const [dx, dy] of SHAPES[type][rotation % 4]) {
    const px = x + dx;
    const py = y + dy;
    if (py < 0) {
      topOut = true;
      continue;
    }
    next[py][px] = type;
  }
  const clearedRows = [];
  next.forEach((row, index) => {
    if (row.every(Boolean)) clearedRows.push(index);
  });
  const clearedResult = clearCompletedLines(next);
  return {
    board: clearedResult.board,
    lines: clearedResult.cleared,
    topOut,
    clearedRows,
  };
}

export function applyPlacement(board, type, rotation, x) {
  const y = getDropY(board, type, rotation, x);
  if (y == null) return null;
  const result = placePieceOnBoard(board, type, rotation, x, y);
  return { ...result, x, y, rotation, type };
}

export class TetrisGame {
  constructor(options = {}) {
    this.width = options.width ?? BOARD_WIDTH;
    this.height = options.height ?? BOARD_HEIGHT;
    this.reset(options.seed ?? Date.now());
  }

  reset(seed = Date.now()) {
    this.seed = seed;
    this.rng = new SeededRandom(seed);
    this.board = createEmptyBoard(this.width, this.height);
    this.queue = [];
    this.current = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.pieces = 0;
    this.status = "idle";
    this.dropAccumulator = 0;
    this.turn = 0;
    this.decisionLog = [];
    this.refillQueue();
    this.spawn();
  }

  refillQueue() {
    while (this.queue.length < 7) {
      this.queue.push(...this.rng.shuffle(PIECE_TYPES));
    }
  }

  spawn() {
    this.refillQueue();
    const type = this.queue.shift();
    this.refillQueue();
    this.current = {
      type,
      x: Math.floor(this.width / 2) - 2,
      y: -2,
      rotation: 0,
    };
    this.turn += 1;
    if (collides(this.board, type, this.current.rotation, this.current.x, this.current.y)) {
      this.status = "gameover";
    }
  }

  start() {
    if (this.status === "idle" || this.status === "paused") {
      this.status = "running";
    }
  }

  pause() {
    if (this.status === "running") this.status = "paused";
  }

  togglePause() {
    if (this.status === "running") this.pause();
    else if (this.status !== "gameover") this.start();
  }

  getDropInterval() {
    return Math.max(80, 760 - (this.level - 1) * 62);
  }

  tick(deltaMs) {
    if (this.status !== "running") return;
    this.dropAccumulator += deltaMs;
    const interval = this.getDropInterval();
    while (this.dropAccumulator >= interval && this.status === "running") {
      this.dropAccumulator -= interval;
      this.softDrop(false);
    }
  }

  isValid(piece = this.current) {
    if (!piece) return false;
    return !collides(this.board, piece.type, piece.rotation, piece.x, piece.y);
  }

  move(dx, dy) {
    if (this.status !== "running" || !this.current) return false;
    const next = { ...this.current, x: this.current.x + dx, y: this.current.y + dy };
    if (this.isValid(next)) {
      this.current = next;
      return true;
    }
    if (dy > 0) this.lockPiece();
    return false;
  }

  softDrop(addScore = true) {
    const moved = this.move(0, 1);
    if (moved && addScore) this.score += 1;
    return moved;
  }

  hardDrop() {
    if (this.status !== "running" || !this.current) return 0;
    const y = getDropY(this.board, this.current.type, this.current.rotation, this.current.x);
    if (y == null) return 0;
    const distance = Math.max(0, y - this.current.y);
    this.current = { ...this.current, y };
    this.score += distance * 2;
    this.lockPiece();
    return distance;
  }

  rotate(direction = 1) {
    if (this.status !== "running" || !this.current) return false;
    const rotation = (this.current.rotation + direction + 4) % 4;
    for (const [kx, ky] of KICKS) {
      const next = {
        ...this.current,
        rotation,
        x: this.current.x + kx,
        y: this.current.y + ky,
      };
      if (this.isValid(next)) {
        this.current = next;
        return true;
      }
    }
    return false;
  }

  lockPiece() {
    if (!this.current) return;
    const result = placePieceOnBoard(
      this.board,
      this.current.type,
      this.current.rotation,
      this.current.x,
      this.current.y,
    );
    this.board = result.board;
    this.pieces += 1;
    if (result.lines > 0) {
      this.lines += result.lines;
      this.level = Math.floor(this.lines / 10) + 1;
      this.score += LINE_SCORES[result.lines] * this.level;
    }
    if (result.topOut) {
      this.status = "gameover";
      return;
    }
    this.spawn();
  }

  applyAction(action) {
    switch (action) {
      case "left":
        return this.move(-1, 0);
      case "right":
        return this.move(1, 0);
      case "down":
      case "softDrop":
        return this.softDrop(true);
      case "rotateCW":
      case "up":
        return this.rotate(1);
      case "rotateCCW":
        return this.rotate(-1);
      case "hardDrop":
      case "space":
        return this.hardDrop();
      default:
        return false;
    }
  }

  applyMoveTarget(move) {
    if (!move || this.status !== "running" || !this.current) return false;
    const targetRotation = Number(move.rotation ?? this.current.rotation) % 4;
    let guard = 0;
    while (this.current.rotation !== targetRotation && guard < 4) {
      this.rotate(1);
      guard += 1;
    }
    const targetX = Number(move.x ?? this.current.x);
    guard = 0;
    while (this.current.x < targetX && guard < 12) {
      if (!this.move(1, 0)) break;
      guard += 1;
    }
    guard = 0;
    while (this.current.x > targetX && guard < 12) {
      if (!this.move(-1, 0)) break;
      guard += 1;
    }
    this.hardDrop();
    return true;
  }

  getGhostPiece() {
    if (!this.current) return null;
    const y = getDropY(this.board, this.current.type, this.current.rotation, this.current.x);
    if (y == null) return null;
    return { ...this.current, y };
  }

  getState() {
    return {
      type: "state",
      width: this.width,
      height: this.height,
      board: cloneBoard(this.board),
      current: this.current ? { ...this.current } : null,
      next: this.queue.slice(0, 5),
      score: this.score,
      lines: this.lines,
      level: this.level,
      pieces: this.pieces,
      status: this.status,
      seed: this.seed,
      turn: this.turn,
    };
  }
}
