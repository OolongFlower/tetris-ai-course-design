import { playFastTetrisGame } from "./fastTetris.js";

let seedPrefix = "benchmark-10x10";
let maxPieces = 100000;
let warmupGames = 1;

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    seedPrefix = message.seedPrefix || seedPrefix;
    maxPieces = Math.max(100000, Number(message.maxPieces ?? maxPieces));
    warmupGames = Math.max(0, Number(message.warmupGames ?? warmupGames));
    for (let i = 0; i < warmupGames; i += 1) {
      playFastTetrisGame({
        gameIndex: -1,
        seed: `browser-warmup-${message.workerId ?? 0}-${i}`,
        maxPieces,
      });
    }
    self.postMessage({ type: "ready", workerId: message.workerId });
  } else if (message.type === "run") {
    const results = [];
    for (let gameIndex = message.start; gameIndex < message.end; gameIndex += 1) {
      const startedAt = performance.now();
      const result = playFastTetrisGame({
        gameIndex,
        seed: `${seedPrefix}-${gameIndex + 1}`,
        maxPieces,
      });
      result.elapsedMs = performance.now() - startedAt;
      results.push(result);
    }
    self.postMessage({ type: "batchDone", workerId: message.workerId, results });
  } else if (message.type === "stop") {
    self.close();
  }
};
