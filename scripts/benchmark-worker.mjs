import { parentPort, workerData } from "node:worker_threads";
import {
  createAi,
  DEFAULT_MAX_PIECES,
  DEFAULT_SEED_PREFIX,
  normalizeProfile,
  playGameWithAi,
  seedForGame,
  summarizeResults,
} from "./lib/benchmarkCore.mjs";

const {
  workerId,
  workerCount,
  games,
  profile = "dt10-2013",
  maxPieces = DEFAULT_MAX_PIECES,
  seedPrefix = DEFAULT_SEED_PREFIX,
  progressEvery = 50,
} = workerData;

const mode = normalizeProfile(profile);
const ai = createAi(mode);
const results = [];
let completed = 0;

for (let gameIndex = workerId; gameIndex < games; gameIndex += workerCount) {
  results.push(
    playGameWithAi(ai, {
      gameIndex,
      seed: seedForGame(seedPrefix, gameIndex),
      mode,
      maxPieces,
    }),
  );
  completed += 1;
  if (progressEvery > 0 && completed % progressEvery === 0) {
    parentPort.postMessage({ type: "progress", completed });
  }
}

const localElapsedSeconds =
  results.reduce((sum, result) => sum + result.elapsedMs, 0) / 1000;
parentPort.postMessage({
  type: "done",
  workerId,
  completed,
  summary: summarizeResults(results, localElapsedSeconds),
  results,
});
