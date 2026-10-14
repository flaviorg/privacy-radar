import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./paths.ts";

type PackageJson = { version?: unknown; repository?: { url?: unknown } };

const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as PackageJson;

export const TOOL_NAME = "privacy-radar";
export const TOOL_VERSION: string = typeof pkg.version === "string" ? pkg.version : "0.0.0";
export const REPOSITORY_URL: string = typeof pkg.repository?.url === "string" ? pkg.repository.url : "";
