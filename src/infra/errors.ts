export type ErrorCode =
  | "USAGE"
  | "CONFIG_INVALID"
  | "CATALOG_INVALID"
  | "SARIF_INVALID"
  | "PR_TOO_LARGE"
  | "UNSCRIPTED_LLM_CALL"
  | "FIXTURE_PROMPT_DRIFT"
  | "TARGET_NOT_FOUND"
  | "NO_SUPPORTED_FILES"
  | "GIT_ERROR"
  | "OUT_NOT_WRITABLE";

/** Exit codes of spec 5.13: 2 for usage and contract problems, 3 for environment problems. */
export const EXIT_CODE: Readonly<Record<ErrorCode, 2 | 3>> = Object.freeze({
  USAGE: 2,
  CONFIG_INVALID: 2,
  CATALOG_INVALID: 2,
  SARIF_INVALID: 2,
  PR_TOO_LARGE: 2,
  UNSCRIPTED_LLM_CALL: 2,
  FIXTURE_PROMPT_DRIFT: 2,
  TARGET_NOT_FOUND: 3,
  NO_SUPPORTED_FILES: 3,
  GIT_ERROR: 3,
  OUT_NOT_WRITABLE: 3,
});

export class PrivacyRadarError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: 2 | 3;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "PrivacyRadarError";
    this.code = code;
    this.exitCode = EXIT_CODE[code];
  }
}

/** A fake-provider turn is missing from an existing fixture: a fixture-authoring error. */
export class UnscriptedLlmCallError extends PrivacyRadarError {
  constructor(message: string) {
    super("UNSCRIPTED_LLM_CALL", message);
    this.name = "UnscriptedLlmCallError";
  }
}

/** The prompt hashes of a fake fixture no longer match the prompts: run `npm run fixtures:rehash`. */
export class FixturePromptDriftError extends PrivacyRadarError {
  constructor(message: string) {
    super("FIXTURE_PROMPT_DRIFT", message);
    this.name = "FixturePromptDriftError";
  }
}

export function exitCodeOf(err: unknown): 2 | 3 {
  return err instanceof PrivacyRadarError ? err.exitCode : 3;
}

/** One line, `error: <CODE>: <message>`, never a stack. Unknown errors are `INTERNAL`. */
export function formatCliError(err: unknown, redact: (s: string) => string): string {
  if (err instanceof PrivacyRadarError) {
    return redact(`error: ${err.code}: ${err.message.replace(/\s*\r?\n\s*/g, " ").trim()}`);
  }
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
  return redact(`error: INTERNAL: ${firstLine}`);
}
