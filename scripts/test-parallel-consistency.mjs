import { spawnSync } from "node:child_process";

const games = Number(process.argv[2] ?? 4);
const workerModes = ["1", "2", "4", "auto"];
const reports = workerModes.map((workers) => runBenchmark(workers));
const expected = reports[0].scoreCsv;

for (const report of reports) {
  if (report.scoreCsv !== expected) {
    throw new Error(
      `Parallel score mismatch for workers=${report.workers}\nexpected=${expected}\nactual=${report.scoreCsv}`,
    );
  }
  if (report.capped !== 0) {
    throw new Error(`Parallel consistency run capped with workers=${report.workers}`);
  }
}

console.log(
  `Parallel consistency passed for ${games} games: workers=${workerModes.join(", ")}.`,
);

function runBenchmark(workers) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/benchmark-parallel.mjs",
      "--games",
      String(games),
      "--workers",
      workers,
      "--profile",
      "dt10-2013",
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
