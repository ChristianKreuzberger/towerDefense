import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  deriveBalanceReport,
  extractBalanceAnalysisSnapshots,
  formatBalanceReport
} from "./balance-report.js";

interface CliArgs {
  inputPath: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let inputPath = "";

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "--input" || token === "-i") {
      const value = args.shift();
      if (!value) {
        throw new Error("missing value for --input");
      }

      inputPath = value;
      continue;
    }

    if (token === "--help" || token === "-h") {
      throw new Error("help");
    }

    if (!token.startsWith("-")) {
      inputPath = token;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  if (!inputPath) {
    throw new Error("missing input path; pass --input <path-to-json>");
  }

  return { inputPath };
}

function usage(): string {
  return [
    "Offline balance report utility",
    "Usage:",
    "  node dist/balance-report.cli.js --input <path-to-snapshot-json>",
    "  node dist/balance-report.cli.js <path-to-snapshot-json>",
    "",
    "Accepted JSON payloads:",
    "  - BalanceAnalysisSnapshot",
    "  - BalanceAnalysisSnapshot[]",
    "  - { balanceAnalysisExports: BalanceAnalysisSnapshot[] }",
    "  - { snapshots: BalanceAnalysisSnapshot[] }"
  ].join("\n");
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
    const filePath = resolve(process.cwd(), args.inputPath);
    const jsonText = readFileSync(filePath, "utf8");
    const json = JSON.parse(jsonText) as unknown;
    const snapshots = extractBalanceAnalysisSnapshots(json);
    const report = deriveBalanceReport(snapshots);
    process.stdout.write(formatBalanceReport(report));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown execution error";
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));