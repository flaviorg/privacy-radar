// A tiny pino-like logger: every property of `logger` is a function.
function write(level: string, message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${level} ${message}\n`);
}

function info(message: string): void {
  write("info", message);
}

function debug(message: string): void {
  write("debug", message);
}

function error(message: string): void {
  write("error", message);
}

export const logger = { info, debug, error };
