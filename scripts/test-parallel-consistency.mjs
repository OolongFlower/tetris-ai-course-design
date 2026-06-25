import { spawnSync } from "node:child_process";

const games = Number(process.argv[2] ?? 4);
const workerModes = ["1", "2", "4", "auto"];
const batchSizes = ["1", "2", "5", "10", "20"];
const reports = [];
for (const workers of workerModes) {
  for (const batchSize of batchSizes) {
    reports.push(runBenchmark(workers, batchSize));
  }
}
const expected = reports[0].scoreCsv;

for (const report of reports) {
  if (report.scoreCsv !== expected) {
    throw new Error(
      `Parallel score mismatch for workers=${report.workers}, batchSize=${report.batchSize}\nexpected=${expected}\nactual=${report.scoreCsv}`,
    );
  }
  if (report.capped !== 0) {
    throw new Error(`Parallel consistency run capped with workers=${report.workers}, batchSize=${report.batchSize}`);
  }
}

console.log(
  `Parallel consistency passed for ${games} games: workers=${workerModes.join(", ")}, batchSize=${batchSizes.join(", ")}.`,
);

function runBenchmark(workers, batchSize) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/benchmark-parallel.mjs",
      "--games",
      String(games),
      "--workers",
      workers,
      "--batchSize",
      batchSize,
      "--profile",
      "dt10-2013",
      "--engine",
      "fast",
      "--quiet",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `benchmark-parallel failed for workers=${workers}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}
