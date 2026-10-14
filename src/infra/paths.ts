import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute project root (the folder that holds package.json), no trailing separator. */
export const PROJECT_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const CATALOG_DIR: string = join(PROJECT_ROOT, "catalog");
export const TEMPLATES_DIR: string = join(PROJECT_ROOT, "templates");
export const DEMO_FIXTURE_DIR: string = join(PROJECT_ROOT, "fixtures", "telehealth-clinic");
export const DEMO_BASE_DIR: string = join(PROJECT_ROOT, "fixtures", "telehealth-clinic-base");
export const DEMO_LLM_FIXTURE: string = join(PROJECT_ROOT, "fixtures", "llm", "telehealth-clinic.json");

/** Converts a native path to POSIX separators (outputs always use `/`). */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
