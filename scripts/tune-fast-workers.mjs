import { spawnSync } from "node:child_process";

const games = Number(process.argv[2] ?? 500);
const workersList = [8, 10, 12, 16, 19];
const batchSizes = [1, 2, 5, 10, 20];
const results = [];

for (const workers of workersList) {
  for (const batchSize of batchSizes) {
    const report = runBenchmark(games, workers, batchSize);
    results.push(report);
    console.log(
      [
        `workers=${workers}`,
        `batchSize=${batchSize}`,
        `elapsed=${report.elapsedSeconds.toFixed(3)}s`,
        `pieces/s=${report.piecesPerSecond.toFixed(0)}`,
        `candidates/s=${report.candidatesPerSecond.toFixed(0)}`,
        `mean=${report.mean.toFixed(3)}`,
        `capped=${report.capped}`,
      ].join("  "),
    );
  }
}

results.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
console.log("\nFASTEST");
console.log(JSON.stringify(results[0], null, 2));

function runBenchmark(games, workers, batchSize) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/benchmark-parallel.mjs",
      "--games",
      String(games),
      "--workers",
      String(workers),
      "--batchSize",
      String(batchSize),
      "--engine",
      "fast",
      "--profile",
      "dt10-2013",
      "--quiet",
      "--omitScoreCsv",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `benchmark failed workers=${workers} batchSize=${batchSize}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}
