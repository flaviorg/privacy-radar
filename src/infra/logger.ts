import type { Env } from "./config.ts";
import { systemClock, type Clock } from "./clock.ts";

export type Logger = Record<"debug" | "info" | "warn" | "error", (event: string, fields?: Record<string, unknown>) => void>;

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

export function createLogger(opts: {
  level: Env["LOG_LEVEL"];
  write?: (line: string) => void;
  redact: (s: string) => string;
  clock?: Clock;
}): Logger {
  const write = opts.write ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const clock = opts.clock ?? systemClock;
  const emit = (level: Level) => (event: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[opts.level]) return;
    const record = { ...fields, ts: clock().toISOString(), level, event };
    const { ts, level: lv, event: ev, ...rest } = record;
    write(opts.redact(JSON.stringify({ ts, level: lv, event: ev, ...rest })));
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

const noop = () => {};
export const silentLogger: Logger = { debug: noop, info: noop, warn: noop, error: noop };
