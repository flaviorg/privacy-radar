import { scanResultSchema, type ScanResult } from "../contracts/findings.ts";

/** `findings.json`: the scan result validated by `scanResultSchema` (keys in schema order), 2-space JSON and a trailing newline. */
export function toFindingsJson(result: ScanResult): string {
  return `${JSON.stringify(scanResultSchema.parse(result), null, 2)}\n`;
}
