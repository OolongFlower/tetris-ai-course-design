import { COLORS, SHAPES } from "./tetrominoes.js";

const BOARD_BG = "#10212a";
const GRID = "rgba(255,255,255,0.08)";
const GHOST = "rgba(255,255,255,0.24)";
const RECOMMEND = "rgba(255,213,79,0.32)";

export function setupCanvas(canvas, cssWidth, cssHeight) {
  const ratio = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

export function drawBoard(ctx, canvas, state, ghost, recommendation) {
  const width = state.width;
  const height = state.height;
  const cssWidth = Number.parseFloat(canvas.style.width) || canvas.width;
  const cssHeight = Number.parseFloat(canvas.style.height) || canvas.height;
  const cell = Math.min(cssWidth / width, cssHeight / height);
  const offsetX = (cssWidth - cell * width) / 2;
  const offsetY = (cssHeight - cell * height) / 2;

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  roundRect(ctx, offsetX, offsetY, cell * width, cell * height, 8, BOARD_BG);

  drawGrid(ctx, offsetX, offsetY, width, height, cell);
  drawBoardCells(ctx, state.board, offsetX, offsetY, cell, 1);

  if (recommendation) {
    drawPieceCells(ctx, recommendation.type, recommendation.rotation, recommendation.x, recommendation.y, offsetX, offsetY, cell, RECOMMEND, true);
  }

  if (ghost) {
    drawPieceCells(ctx, ghost.type, ghost.rotation, ghost.x, ghost.y, offsetX, offsetY, cell, GHOST, true);
  }

  if (state.current) {
    drawPieceCells(
      ctx,
      state.current.type,
      state.current.rotation,
      state.current.x,
      state.current.y,
      offsetX,
      offsetY,
      cell,
      COLORS[state.current.type],
      false,
    );
  }

  drawFrame(ctx, offsetX, offsetY, width * cell, height * cell);
}

function drawGrid(ctx, offsetX, offsetY, width, height, cell) {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 1) {
    const px = offsetX + x * cell;
    ctx.beginPath();
    ctx.moveTo(px, offsetY);
    ctx.lineTo(px, offsetY + height * cell);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 1) {
    const py = offsetY + y * cell;
    ctx.beginPath();
    ctx.moveTo(offsetX, py);
    ctx.lineTo(offsetX + width * cell, py);
    ctx.stroke();
  }
}

function drawBoardCells(ctx, board, offsetX, offsetY, cell, alpha) {
  board.forEach((row, y) => {
    row.forEach((type, x) => {
      if (!type) return;
      drawBlock(ctx, offsetX + x * cell, offsetY + y * cell, cell, COLORS[type] ?? "#8aa1ac", alpha);
    });
  });
}

export function drawPieceCells(ctx, type, rotation, x, y, offsetX, offsetY, cell, color, outlineOnly) {
  for (const [dx, dy] of SHAPES[type][rotation % 4]) {
    const py = y + dy;
    if (py < 0) continue;
    const px = x + dx;
    if (outlineOnly) drawOutlineBlock(ctx, offsetX + px * cell, offsetY + py * cell, cell, color);
    else drawBlock(ctx, offsetX + px * cell, offsetY + py * cell, cell, color, 1);
  }
}

function drawBlock(ctx, x, y, size, color, alpha = 1) {
  const pad = Math.max(1.5, size * 0.065);
  ctx.save();
  ctx.globalAlpha = alpha;
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, shade(color, 28));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, shade(color, -18));
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, Math.max(4, size * 0.14), grad);
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  roundStroke(ctx, x + pad + 0.5, y + pad + 0.5, size - pad * 2 - 1, size - pad * 2 - 1, Math.max(4, size * 0.14));
  ctx.restore();
}

function drawOutlineBlock(ctx, x, y, size, color) {
  const pad = Math.max(2, size * 0.08);
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.2;
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, Math.max(4, size * 0.14), color);
  roundStroke(ctx, x + pad + 0.5, y + pad + 0.5, size - pad * 2 - 1, size - pad * 2 - 1, Math.max(4, size * 0.14));
  ctx.restore();
}

export function drawNextQueue(ctx, canvas, queue) {
  const cssWidth = Number.parseFloat(canvas.style.width) || canvas.width;
  const cssHeight = Number.parseFloat(canvas.style.height) || canvas.height;
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const cell = 20;
  queue.slice(0, 5).forEach((type, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const baseX = 22 + col * 104;
    const baseY = 18 + row * 58;
    for (const [dx, dy] of SHAPES[type][0]) {
      drawBlock(ctx, baseX + dx * cell, baseY + dy * cell, cell, COLORS[type], index === 0 ? 1 : 0.68);
    }
  });
}

function drawFrame(ctx, x, y, width, height) {
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2;
  roundStroke(ctx, x + 1, y + 1, width - 2, height - 2, 8);
}

function roundRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function roundStroke(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.stroke();
}

function shade(hex, amount) {
  const raw = hex.replace("#", "");
  const num = Number.parseInt(raw, 16);
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 255) + amount);
  const b = clamp((num & 255) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}
