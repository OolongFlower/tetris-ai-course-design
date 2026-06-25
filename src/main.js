import { TetrisGame } from "./tetrisCore.js";
import { AI_VERSION, TetrisAI } from "./ai.js?v=fast-worker";
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
  benchWorkers: document.querySelector("#benchWorkers"),
  downloadBenchBtn: document.querySelector("#downloadBenchBtn"),
  benchmarkState: document.querySelector("#benchmarkState"),
  benchmarkOutput: document.querySelector("#benchmarkOutput"),
  gameOverOverlay: document.querySelector("#gameOverOverlay"),
  gameOverSummary: document.querySelector("#gameOverSummary"),
  restartOverlayBtn: document.querySelector("#restartOverlayBtn"),
};

const boardCtx = setupCanvas(elements.boardCanvas, 420, 420);
const nextCtx = setupCanvas(elements.nextCanvas, 240, 190);
const ai = new TetrisAI({ mode: "dt10" });
const wsClient = new AiSocketClient();

let game = new TetrisGame({ seed: elements.seedInput.value });
let lastFrame = performance.now();
let lastAiTurn = -1;
let aiPending = false;
let recommendation = null;
let benchmarkRunning = false;
let benchmarkWorkers = [];
let benchmarkResults = [];
let benchmarkCsv = "";
let benchmarkStartedAt = 0;
let benchmarkNextIndex = 0;
let benchmarkCompleted = 0;
let benchmarkStats = null;
let benchmarkConfig = null;

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

elements.newGameBtn.addEventListener("click", startNewGame);
elements.restartOverlayBtn.addEventListener("click", startNewGame);

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
    aiVersion: AI_VERSION,
    log: game.decisionLog,
  };
  downloadText(`tetris-ai-log-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
});

elements.benchmarkBtn.addEventListener("click", () => {
  if (benchmarkRunning) {
    stopBenchmark();
  } else {
    runBenchmark();
  }
});

elements.downloadBenchBtn.addEventListener("click", () => {
  if (!benchmarkCsv) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadText(`tetris-benchmark-${stamp}.csv`, benchmarkCsv, "text/csv;charset=utf-8");
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
  let move;
  try {
    if (!wsClient.isOpen()) {
      elements.aiSource.textContent = "请先连接 AI 服务";
      aiPending = false;
      return;
    }
    move = await wsClient.requestMove({ ...state, depth: 1 }, 600);
    elements.aiSource.textContent = move.aiVersion ?? "Python WebSocket AI";
  } catch {
    elements.aiSource.textContent = "WebSocket 响应失败";
    aiPending = false;
    return;
  }

  if (move?.error) {
    elements.aiSource.textContent = move.error;
    game.status = "gameover";
  } else if (move && game.status === "running") {
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
    if (!game.applyMoveTarget(move)) game.status = "gameover";
  }
  aiPending = false;
}

function updateRecommendation() {
  const state = game.getState();
  const move = ai.findBestMove(state, { mode: "dt10" });
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
  elements.moveFeatures.textContent = [
    `高${fmt(f.landingHeight)}`,
    `蚀${fmt(f.erodedPieceCells)}`,
    `行转${fmt(f.rowTransitions)}`,
    `列转${fmt(f.columnTransitions)}`,
    `洞${fmt(f.holes)}`,
    `井${fmt(f.boardWells)}`,
    `洞深${fmt(f.holeDepth)}`,
    `洞行${fmt(f.rowsWithHoles)}`,
    `多样${fmt(f.diversity)}`,
  ].join(" ");
}

function runBenchmark() {
  if (benchmarkRunning) return;
  benchmarkRunning = true;
  benchmarkWorkers = [];
  benchmarkResults = [];
  benchmarkCsv = "";
  benchmarkNextIndex = 0;
  benchmarkCompleted = 0;
  benchmarkStartedAt = performance.now();
  benchmarkStats = createBenchmarkStats();
  benchmarkConfig = {
    games: Math.max(1, Math.min(10000, Number(elements.benchGames.value) || 10000)),
    workerCount: resolveWorkerCount(elements.benchWorkers.value),
    batchSize: 1,
    seedPrefix: elements.seedInput.value.trim() || "benchmark-10x10",
    maxPieces: 100000,
  };
  benchmarkConfig.workerCount = Math.min(benchmarkConfig.workerCount, benchmarkConfig.games);

  elements.benchmarkBtn.textContent = "停止评测";
  elements.benchmarkState.textContent = "启动中";
  elements.downloadBenchBtn.disabled = true;
  elements.benchGames.disabled = true;
  elements.benchWorkers.disabled = true;
  elements.modeSelect.disabled = true;
  elements.depthSelect.disabled = true;
  updateBenchmarkOutput(false);

  for (let workerId = 0; workerId < benchmarkConfig.workerCount; workerId += 1) {
    const worker = new Worker(new URL("./benchmarkWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => handleBenchmarkWorkerMessage(worker, event.data);
    worker.onerror = (error) => {
      elements.benchmarkOutput.textContent = `评测 Worker 出错：${error.message}`;
      stopBenchmark();
    };
    benchmarkWorkers.push(worker);
    worker.postMessage({
      type: "init",
      workerId,
      seedPrefix: benchmarkConfig.seedPrefix,
      maxPieces: benchmarkConfig.maxPieces,
      warmupGames: 1,
    });
  }
}

function handleBenchmarkWorkerMessage(worker, message) {
  if (!benchmarkRunning) return;
  if (message.type === "ready") {
    assignBenchmarkBatch(worker);
  } else if (message.type === "batchDone") {
    for (const result of message.results) {
      benchmarkResults[result.gameIndex] = result;
      addBenchmarkResult(result);
    }
    benchmarkCompleted += message.results.length;
    updateBenchmarkOutput(false);
    assignBenchmarkBatch(worker);
  }
}

function assignBenchmarkBatch(worker) {
  if (!benchmarkRunning || !benchmarkConfig) return;
  if (benchmarkNextIndex >= benchmarkConfig.games) {
    worker.postMessage({ type: "stop" });
    const index = benchmarkWorkers.indexOf(worker);
    if (index >= 0) benchmarkWorkers.splice(index, 1);
    if (benchmarkWorkers.length === 0) finishBenchmark(false);
    return;
  }
  const start = benchmarkNextIndex;
  const end = Math.min(benchmarkConfig.games, start + benchmarkConfig.batchSize);
  benchmarkNextIndex = end;
  worker.postMessage({ type: "run", start, end });
}

function stopBenchmark() {
  if (!benchmarkRunning) return;
  for (const worker of benchmarkWorkers) worker.terminate();
  benchmarkWorkers = [];
  finishBenchmark(true);
}

function finishBenchmark(canceled) {
  benchmarkRunning = false;
  benchmarkWorkers = [];
  benchmarkCsv = benchmarkCompleted > 0 ? makeBenchmarkCsv(benchmarkResults.filter(Boolean)) : "";
  elements.benchmarkBtn.textContent = "开始评测";
  elements.benchmarkState.textContent = canceled ? "已停止" : "完成";
  elements.downloadBenchBtn.disabled = !benchmarkCsv;
  elements.benchGames.disabled = false;
  elements.benchWorkers.disabled = false;
  elements.modeSelect.disabled = false;
  elements.depthSelect.disabled = false;
  updateBenchmarkOutput(true, canceled);
  updateModeUi();
}

function addBenchmarkResult(result) {
  const stats = benchmarkStats;
  stats.count += 1;
  const delta = result.score - stats.mean;
  stats.mean += delta / stats.count;
  const delta2 = result.score - stats.mean;
  stats.m2 += delta * delta2;
  stats.totalPieces += result.pieces;
  stats.totalCandidates += result.candidatePlacements ?? 0;
  stats.capped += result.capped ? 1 : 0;
  if (result.score < stats.min) stats.min = result.score;
  if (result.score > stats.max) stats.max = result.score;
}

function updateBenchmarkOutput(final, canceled = false) {
  if (!benchmarkStats || !benchmarkConfig) return;
  const elapsed = (performance.now() - benchmarkStartedAt) / 1000;
  const count = benchmarkStats.count;
  const varianceValue = count > 0 ? benchmarkStats.m2 / count : 0;
  const piecesPerSecond = elapsed > 0 ? benchmarkStats.totalPieces / elapsed : 0;
  const candidatesPerSecond = elapsed > 0 ? benchmarkStats.totalCandidates / elapsed : 0;
  const gamesPerSecond = elapsed > 0 ? count / elapsed : 0;
  const remaining = gamesPerSecond > 0 ? (benchmarkConfig.games - count) / gamesPerSecond : 0;
  const title = canceled ? "评测已停止" : final ? "评测完成" : "评测中";
  elements.benchmarkState.textContent = canceled ? "已停止" : final ? "完成" : `${count}/${benchmarkConfig.games}`;
  elements.benchmarkOutput.textContent = [
    `${title}：${count}/${benchmarkConfig.games} 局`,
    `Worker：${benchmarkConfig.workerCount}    Batch：${benchmarkConfig.batchSize}    AI：${AI_VERSION}`,
    `均值：${count ? benchmarkStats.mean.toFixed(4) : "-"}    方差：${count ? varianceValue.toFixed(4) : "-"}`,
    `最高分：${count ? benchmarkStats.max : "-"}    最低分：${count ? benchmarkStats.min : "-"}`,
    `平均方块数：${count ? (benchmarkStats.totalPieces / count).toFixed(2) : "-"}    capped：${benchmarkStats.capped}/${count}`,
    `已用时间：${formatDuration(elapsed)}    预计剩余：${final || canceled ? "0s" : formatDuration(remaining)}`,
    `吞吐：${piecesPerSecond.toFixed(0)} pieces/s    ${candidatesPerSecond.toFixed(0)} candidates/s`,
    `Seed 前缀：${benchmarkConfig.seedPrefix}`,
    benchmarkCsv ? "CSV 已生成，可点击“下载 CSV”。" : "CSV 会在完成或停止后生成。",
  ].join("\n");
}

function createBenchmarkStats() {
  return {
    count: 0,
    mean: 0,
    m2: 0,
    min: Infinity,
    max: -Infinity,
    totalPieces: 0,
    totalCandidates: 0,
    capped: 0,
  };
}

function makeBenchmarkCsv(results) {
  const sorted = [...results].sort((a, b) => a.gameIndex - b.gameIndex);
  const lines = ["gameIndex,seed,score,lines,pieces,candidatePlacements,capped,elapsedMs"];
  for (const result of sorted) {
    lines.push(
      [
        result.gameIndex,
        result.seed,
        result.score,
        result.lines,
        result.pieces,
        result.candidatePlacements ?? 0,
        result.capped ? 1 : 0,
        Number(result.elapsedMs ?? 0).toFixed(3),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function resolveWorkerCount(value) {
  if (value === "auto") {
    return Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
  }
  return Math.max(1, Number(value) || 1);
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function updateModeUi() {
  const humanMode = elements.modeSelect.value === "human";
  if (benchmarkRunning) {
    elements.benchmarkBtn.disabled = false;
    return;
  }
  elements.benchmarkBtn.disabled = humanMode;
  elements.benchmarkBtn.title = humanMode ? "AI 评测只在 AI 算法模式中运行" : "";
  elements.aiSource.textContent = humanMode ? "人类模式推荐落点" : AI_VERSION;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
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
