import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Absolute project root as seen from the tests. */
export const PROJECT_ROOT_FOR_TESTS: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `file://` URL of the no-network guard; a raw path with a space would break `--import`. */
export const GUARD_URL: string = pathToFileURL(resolve(PROJECT_ROOT_FOR_TESTS, "tests", "setup", "no-network.ts")).href;

/** Arguments every test-spawned Node child must receive. */
export const CHILD_NODE_ARGS: readonly string[] = ["--import", GUARD_URL];
