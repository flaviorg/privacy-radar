import { spawn } from "node:child_process";
import { join } from "node:path";
import { DEMO_CLOCK_ISO } from "../../src/infra/clock.ts";
import { CHILD_NODE_ARGS, PROJECT_ROOT_FOR_TESTS } from "./child-node-args.ts";

export const CLI_PATH: string = join(PROJECT_ROOT_FOR_TESTS, "src", "cli.ts");

export type CliRun = { code: number; stdout: string; stderr: string };

/**
 * Runs `node src/cli.ts ...args` with the no-network guard. The child sees only PATH, HOME, the demo
 * clock, LOG_LEVEL=warn and `opts.env`: never the parent's LLM_* variables.
 */
export function runCli(args: string[], opts: { env?: Record<string, string>; cwd?: string } = {}): Promise<CliRun> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PRIVACY_RADAR_CLOCK: DEMO_CLOCK_ISO,
    LOG_LEVEL: "warn",
    ...opts.env,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...CHILD_NODE_ARGS, CLI_PATH, ...args], { cwd: opts.cwd ?? PROJECT_ROOT_FOR_TESTS, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Runs `node <script> ...args` from the project root with the no-network guard. Unlike `runCli` it adds
 * no clock and no LOG_LEVEL: the child sees only PATH, HOME and `opts.env`.
 */
export function runNodeScript(script: string, opts: { env?: Record<string, string>; args?: string[] } = {}): Promise<CliRun> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...opts.env };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...CHILD_NODE_ARGS, join(PROJECT_ROOT_FOR_TESTS, script), ...(opts.args ?? [])], { cwd: PROJECT_ROOT_FOR_TESTS, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
