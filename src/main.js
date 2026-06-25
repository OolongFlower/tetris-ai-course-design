import { TetrisGame } from "./tetrisCore.js";
import { AI_VERSION, TetrisAI } from "./ai.js?v=10x10-lookahead-v3";
import { drawBoard, drawNextQueue, setupCanvas } from "./renderer.js";
import { AiSocketClient } from "./wsClient.js";

const elements = {
  boardCanvas: document.querySelector("#boardCanvas"),
  nextCanvas: document.querySelector("#nextCanvas"),
  newGameBtn: document.querySelector("#newGameBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  modeSelect: document.querySelector("#modeSelect"),
  depthSelect: document.querySelector("#depthSelect"),
  aiDelay: document.querySelector("#aiDelay"),
  aiDelayValue: document.querySelector("#aiDelayValue"),
  seedInput: document.querySelector("#seedInput"),
  connectBtn: document.querySelector("#connectBtn"),
  exportLogBtn: document.querySelector("#exportLogBtn"),
  scoreValue: document.querySelector("#scoreValue"),
  linesValue: document.querySelector("#linesValue"),
  levelValue: document.querySelector("#levelValue"),
  piecesValue: document.querySelector("#piecesValue"),
  gameStatus: document.querySelector("#gameStatus"),
  socketStatus: document.querySelector("#socketStatus"),
  moveX: document.querySelector("#moveX"),
  moveRotation: document.querySelector("#moveRotation"),
  moveScore: document.querySelector("#moveScore"),
  moveFeatures: document.querySelector("#moveFeatures"),
  aiSource: document.querySelector("#aiSource"),
  benchmarkBtn: document.querySelector("#benchmarkBtn"),
  benchGames: document.querySelector("#benchGames"),
  benchmarkState: document.querySelector("#benchmarkState"),
  benchmarkOutput: document.querySelector("#benchmarkOutput"),
  gameOverOverlay: document.querySelector("#gameOverOverlay"),
  gameOverSummary: document.querySelector("#gameOverSummary"),
  restartOverlayBtn: document.querySelector("#restartOverlayBtn"),
};

const boardCtx = setupCanvas(elements.boardCanvas, 420, 420);
const nextCtx = setupCanvas(elements.nextCanvas, 240, 190);
const ai = new TetrisAI();
const wsClient = new AiSocketClient();

let game = new TetrisGame({ seed: elements.seedInput.value });
let lastFrame = performance.now();
let lastAiTurn = -1;
let aiPending = false;
let lastDecision = null;
let recommendation = null;
let benchmarkRunning = false;
let benchmarkCancel = false;

wsClient.onStatus = (status) => {
  const labels = {
    connecting: "WS 连接中",
    open: "WS 已连接",
    closed: "WS 未连接",
    error: "WS 错误",
  };
  elements.socketStatus.textContent = labels[status] ?? status;
  elements.connectBtn.textContent = status === "open" ? "断开 AI 服务" : "连接 AI 服务";
};

elements.newGameBtn.addEventListener("click", () => {
  startNewGame();
});

elements.restartOverlayBtn.addEventListener("click", () => {
  startNewGame();
});

elements.pauseBtn.addEventListener("click", () => {
  if (game.status === "idle") game.start();
  else game.togglePause();
  updatePauseText();
});

elements.modeSelect.addEventListener("change", () => {
  lastAiTurn = -1;
  aiPending = false;
  updateModeUi();
  if (elements.modeSelect.value === "ws-ai") {
    game.start();
    wsClient.connect();
  }
});

elements.aiDelay.addEventListener("input", () => {
  elements.aiDelayValue.textContent = `${elements.aiDelay.value} ms`;
});

elements.connectBtn.addEventListener("click", () => {
  if (wsClient.isOpen()) wsClient.disconnect();
  else wsClient.connect();
});

elements.exportLogBtn.addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    seed: game.seed,
    score: game.score,
    lines: game.lines,
    pieces: game.pieces,
    log: game.decisionLog,
  };
  downloadText(`tetris-ai-log-${Date.now()}.json`, JSON.stringify(payload, null, 2));
});

elements.benchmarkBtn.addEventListener("click", () => {
  if (benchmarkRunning) {
    benchmarkCancel = true;
    elements.benchmarkBtn.disabled = true;
    elements.benchmarkBtn.textContent = "停止中";
    elements.benchmarkState.textContent = "停止中";
    return;
  }
  runBenchmark();
});

window.addEventListener("keydown", (event) => {
  const keyMap = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowDown: "down",
    ArrowUp: "rotateCW",
    " ": "hardDrop",
  };
  if (event.key === "p" || event.key === "P") {
    game.togglePause();
    updatePauseText();
    return;
  }
  if (event.key === "r" || event.key === "R") {
    startNewGame();
    return;
  }
  if (elements.modeSelect.value !== "human") return;
  const action = keyMap[event.key];
  if (!action) return;
  event.preventDefault();
  if (game.status === "idle") game.start();
  game.applyAction(action);
  updateRecommendation();
});

function startNewGame() {
  const seed = elements.seedInput.value.trim() || Date.now();
  game = new TetrisGame({ seed });
  game.start();
  lastAiTurn = -1;
  aiPending = false;
  lastDecision = null;
  recommendation = null;
  updateDecision(null);
  updatePauseText();
}

function updatePauseText() {
  elements.pauseBtn.textContent = game.status === "running" ? "暂停" : "继续";
}

function gameLoop(now) {
  const delta = now - lastFrame;
  lastFrame = now;
  game.tick(delta);
  maybeRunAi();
  render();
  requestAnimationFrame(gameLoop);
}

async function maybeRunAi() {
  const mode = elements.modeSelect.value;
  if (mode !== "ws-ai" || game.status !== "running" || aiPending || game.turn === lastAiTurn) return;
  lastAiTurn = game.turn;
  aiPending = true;
  const delay = Number(elements.aiDelay.value);
  if (delay > 0) await sleep(delay);
  if (game.status !== "running") {
    aiPending = false;
    return;
  }
  const state = game.getState();
  const depth = Number(elements.depthSelect.value);
  let move;
  try {
    if (!wsClient.isOpen()) {
      elements.aiSource.textContent = "请先连接 AI 服务";
      aiPending = false;
      return;
    }
    move = await wsClient.requestMove({ ...state, depth }, 600);
    elements.aiSource.textContent = "Python WebSocket AI";
  } catch (error) {
    elements.aiSource.textContent = "WebSocket 响应失败";
    aiPending = false;
    return;
  }
  if (move && game.status === "running") {
    lastDecision = move;
    recommendation = {
      type: state.current.type,
      rotation: move.rotation,
      x: move.x,
      y: move.y,
    };
    updateDecision(move);
    game.decisionLog.push({
      turn: state.turn,
      piece: state.current.type,
      score: state.score,
      lines: state.lines,
      move,
    });
    game.applyMoveTarget(move);
  }
  aiPending = false;
}

function updateRecommendation() {
  const state = game.getState();
  const move = ai.findBestMove(state, { depth: Number(elements.depthSelect.value) });
  if (!move || !state.current) {
    recommendation = null;
    return;
  }
  recommendation = {
    type: state.current.type,
    rotation: move.rotation,
    x: move.x,
    y: move.y,
  };
}

function render() {
  const state = game.getState();
  if (elements.modeSelect.value === "human" && state.status === "running") {
    updateRecommendation();
  }
  drawBoard(boardCtx, elements.boardCanvas, state, game.getGhostPiece(), recommendation);
  drawNextQueue(nextCtx, elements.nextCanvas, state.next);
  elements.scoreValue.textContent = String(state.score);
  elements.linesValue.textContent = String(state.lines);
  elements.levelValue.textContent = String(state.level);
  elements.piecesValue.textContent = String(state.pieces);
  const statusLabels = {
    idle: "待开始",
    running: "运行中",
    paused: "已暂停",
    gameover: "游戏结束",
  };
  elements.gameStatus.textContent = statusLabels[state.status] ?? state.status;
  updateGameOverOverlay(state);
  if (state.status === "gameover") updatePauseText();
}

function updateGameOverOverlay(state) {
  const gameOver = state.status === "gameover";
  elements.gameOverOverlay.classList.toggle("hidden", !gameOver);
  if (gameOver) {
    elements.gameOverSummary.textContent = `消行 ${state.lines} · 得分 ${state.score}`;
  }
}

function updateDecision(move) {
  if (!move) {
    elements.moveX.textContent = "-";
    elements.moveRotation.textContent = "-";
    elements.moveScore.textContent = "-";
    elements.moveFeatures.textContent = "-";
    return;
  }
  elements.moveX.textContent = String(move.x);
  elements.moveRotation.textContent = `${move.rotation * 90}°`;
  elements.moveScore.textContent = Number(move.eval ?? move.score).toFixed(3);
  const f = move.features ?? {};
  elements.moveFeatures.textContent = `高${fmt(f.aggregateHeight)} 洞${fmt(f.holes)} 崎${fmt(f.bumpiness)} 消${fmt(f.completeLines)}`;
}

async function runBenchmark() {
  if (benchmarkRunning) return;
  if (elements.modeSelect.value === "human") {
    elements.benchmarkState.textContent = "未开始";
    elements.benchmarkOutput.textContent = "AI 评测属于 AI 算法模式。请先切换到 AI 算法模式（WebSocket），再运行评测。";
    return;
  }
  benchmarkRunning = true;
  benchmarkCancel = false;
  elements.benchmarkBtn.disabled = true;
  elements.benchmarkBtn.textContent = "停止评测";
  elements.benchmarkBtn.disabled = false;
  elements.modeSelect.disabled = true;
  elements.depthSelect.disabled = true;
  elements.benchGames.disabled = true;
  const games = Math.max(1, Math.min(10000, Number(elements.benchGames.value) || 10000));
  const depth = Number(elements.depthSelect.value);
  const seed = elements.seedInput.value.trim() || "benchmark";
  const results = [];
  elements.benchmarkOutput.textContent = "";

  for (let i = 0; i < games && !benchmarkCancel; i += 1) {
    elements.benchmarkState.textContent = `${i + 1}/${games}`;
    const result = await playAiGameAsync(`${seed}-${i + 1}`, depth);
    if (result.completed) results.push(result);
    elements.benchmarkOutput.textContent = summarizeBenchmark(results, false, benchmarkCancel);
    await sleep(0);
  }

  elements.benchmarkOutput.textContent = summarizeBenchmark(results, true, benchmarkCancel);
  elements.benchmarkState.textContent = benchmarkCancel ? "已停止" : "完成";
  elements.benchmarkBtn.textContent = "开始评测";
  benchmarkRunning = false;
  benchmarkCancel = false;
  elements.modeSelect.disabled = false;
  elements.depthSelect.disabled = false;
  elements.benchGames.disabled = false;
  updateModeUi();
}

async function playAiGameAsync(seed, depth) {
  const sim = new TetrisGame({ seed });
  sim.start();
  let guard = 0;
  const maxPieces = 20000;
  let stopped = false;
  while (sim.status === "running" && guard < maxPieces && !benchmarkCancel) {
    for (let batch = 0; batch < 120 && sim.status === "running" && guard < maxPieces && !stopped && !benchmarkCancel; batch += 1) {
      const state = sim.getState();
      const move = ai.findBestMove(state, { depth });
      if (!move) {
        stopped = true;
        break;
      }
      sim.applyMoveTarget(move);
      guard += 1;
    }
    if (stopped) break;
    await sleep(0);
  }
  return {
    lines: sim.lines,
    score: sim.score,
    pieces: sim.pieces,
    status: sim.status,
    capped: guard >= maxPieces,
    canceled: benchmarkCancel,
    completed: sim.status !== "running" || guard >= maxPieces,
  };
}

function summarizeBenchmark(results, final, canceled = false) {
  if (results.length === 0) {
    return canceled ? "评测已停止：尚未完成任何完整局。" : "评测准备中。";
  }
  const scores = results.map((result) => result.score);
  const lines = results.map((result) => result.lines);
  const pieces = results.map((result) => result.pieces);
  const avgScore = average(scores);
  const scoreVariance = variance(scores);
  const avgLines = average(lines);
  const avgPieces = average(pieces);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const capped = results.filter((result) => result.capped).length;
  return [
    `${canceled ? "评测已停止" : final ? "评测完成" : "评测中"}：${lines.length} 局完整结果`,
    `分数均值：${avgScore.toFixed(4)}    分数方差：${scoreVariance.toFixed(4)}`,
    `最高分：${max}    最低分：${min}`,
    `平均消行：${avgLines.toFixed(4)}    平均方块数：${avgPieces.toFixed(2)}`,
    `预算结束：${capped}/${lines.length}`,
    `AI 版本：${AI_VERSION}`,
    `规则：10×10 布局，7 种方块独立等概率刷新，消除 1 行得 1 分`,
    `说明：评测是独立批量仿真实验；WebSocket 用于演示 JSON 接口落子`,
  ].join("\n");
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function variance(values) {
  if (values.length === 0) return 0;
  const avg = average(values);
  return average(values.map((value) => (value - avg) ** 2));
}

function fmt(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(0);
}

function updateModeUi() {
  const humanMode = elements.modeSelect.value === "human";
  if (benchmarkRunning) {
    elements.benchmarkBtn.disabled = false;
    return;
  }
  elements.benchmarkBtn.disabled = humanMode;
  elements.benchmarkBtn.title = humanMode ? "AI 评测只在 AI 算法模式下运行" : "";
  elements.aiSource.textContent = humanMode ? "人类模式推荐落点" : "Python WebSocket AI";
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

startNewGame();
updateModeUi();
requestAnimationFrame(gameLoop);
