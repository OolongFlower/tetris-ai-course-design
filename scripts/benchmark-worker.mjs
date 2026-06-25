import { parentPort, workerData } from "node:worker_threads";
import {
  DEFAULT_MAX_PIECES,
  DEFAULT_SEED_PREFIX,
  normalizeProfile,
  playBenchmarkGame,
  seedForGame,
} from "./lib/benchmarkCore.mjs";

const {
  workerId,
  profile = "dt10-2013",
  engine = "fast",
  maxPieces = DEFAULT_MAX_PIECES,
  seedPrefix = DEFAULT_SEED_PREFIX,
  warmupGames = 2,
} = workerData;

const mode = normalizeProfile(profile);

for (let i = 0; i < warmupGames; i += 1) {
  playBenchmarkGame({
    engine,
    gameIndex: -1,
    seed: `warmup-${workerId}-${i}`,
    mode,
    maxPieces,
  });
}

parentPort.on("message", (message) => {
  if (message.type === "run") {
    const results = [];
    for (let gameIndex = message.start; gameIndex < message.end; gameIndex += 1) {
      results.push(
        playBenchmarkGame({
          engine,
          gameIndex,
          seed: seedForGame(seedPrefix, gameIndex),
          mode,
          maxPieces,
        }),
      );
    }
    parentPort.postMessage({ type: "batchDone", workerId, results });
  } else if (message.type === "stop") {
    process.exit(0);
  }
});

parentPort.postMessage({ type: "ready", workerId });
