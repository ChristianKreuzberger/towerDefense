import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  diffBaselineArtifacts,
  formatBaselineDiffSummary,
  loadBaselineArtifacts
} from "./baseline-diff.js";

interface CliArgs {
  baselineDir: string;
  candidateDir: string;
  jsonOutPath: string;
  printSummary: boolean;
  failOnDrift: boolean;
}

function usage(): string {
  return [
    "Deterministic baseline drift utility",
    "Usage:",
    "  node dist/baseline-diff.cli.js",
    "  node dist/baseline-diff.cli.js --baseline <dir> --candidate <dir>",
    "  node dist/baseline-diff.cli.js --json-out <path>",
    "  node dist/baseline-diff.cli.js --stdout",
    "",
    "Defaults:",
    "  --baseline artifacts/baselines/balance",
    "  --candidate artifacts/baselines/balance",
    "  --json-out artifacts/baselines/balance/baseline-diff.result.json",
    "  --fail-on-drift true"
  ].join("\n");
}

function parseBooleanToken(token: string, flagName: string): boolean {
  if (token === "true") {
    return true;
  }

  if (token === "false") {
    return false;
  }

  throw new Error(`invalid value for ${flagName}; expected true|false`);
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let baselineDir = "artifacts/baselines/balance";
  let candidateDir = "artifacts/baselines/balance";
  let jsonOutPath = "artifacts/baselines/balance/baseline-diff.result.json";
  let printSummary = false;
  let failOnDrift = true;

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "--baseline") {
      const value = args.shift();
      if (!value) {
        throw new Error("missing value for --baseline");
      }
      baselineDir = value;
      continue;
    }

    if (token === "--candidate") {
      const value = args.shift();
      if (!value) {
        throw new Error("missing value for --candidate");
      }
      candidateDir = value;
      continue;
    }

    if (token === "--json-out") {
      const value = args.shift();
      if (!value) {
        throw new Error("missing value for --json-out");
      }
      jsonOutPath = value;
      continue;
    }

    if (token === "--fail-on-drift") {
      const value = args.shift();
      if (!value) {
        throw new Error("missing value for --fail-on-drift");
      }
      failOnDrift = parseBooleanToken(value, "--fail-on-drift");
      continue;
    }

    if (token === "--stdout") {
      printSummary = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      throw new Error("help");
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return {
    baselineDir,
    candidateDir,
    jsonOutPath,
    printSummary,
    failOnDrift
  };
}

function main(argv: string[]): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown argument error";
    if (message === "help") {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }

    process.stderr.write(`Error: ${message}\n\n${usage()}\n`);
    return 1;
  }

  try {
    const baseline = loadBaselineArtifacts(args.baselineDir);
    const candidate = loadBaselineArtifacts(args.candidateDir);
    const diff = diffBaselineArtifacts(baseline, candidate);
    const summary = formatBaselineDiffSummary(diff);
    const outputPath = resolve(process.cwd(), args.jsonOutPath);

    writeFileSync(outputPath, `${JSON.stringify(diff, null, 2)}\n`, "utf8");

    if (args.printSummary) {
      process.stdout.write(summary);
      process.stdout.write(`JSON result: ${outputPath}\n`);
    }

    if (!diff.pass && args.failOnDrift) {
      return 2;
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown execution error";
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
