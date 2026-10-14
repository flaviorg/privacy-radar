import type { ProjectConfig } from "../contracts/config.ts";
import type { Finding } from "../contracts/findings.ts";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * ENG-07: a suppression matches by `fingerprint`, or by `rule` + `file` + `line`; one whose `until`
 * is before today (UTC day, inclusive) does not suppress. Matched findings stay in the list with
 * `suppressed: { reason, by, until? }`; the first matching suppression wins.
 */
export function applySuppressions(findings: readonly Finding[], config: ProjectConfig, today: Date): Finding[] {
  const day = isoDay(today);
  const active = (config.suppressions ?? []).filter((s) => s.until === undefined || s.until >= day);
  if (active.length === 0) return [...findings];
  return findings.map((f) => {
    const s = active.find((x) =>
      "fingerprint" in x ? x.fingerprint === f.fingerprint : x.rule === f.ruleId && x.file === f.location.file && x.line === f.location.line,
    );
    if (!s) return f;
    return { ...f, suppressed: s.until === undefined ? { reason: s.reason, by: s.by } : { reason: s.reason, by: s.by, until: s.until } };
  });
}

const GLOB_CACHE = new Map<string, RegExp>();

/** `**` any depth (including none), `*` within a segment, `?` one character; everything else literal. */
function globRegex(glob: string): RegExp {
  let re = GLOB_CACHE.get(glob);
  if (re) return re;
  let src = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      src += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") src += "[^/]*";
    else if (c === "?") src += "[^/]";
    else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  re = new RegExp(`^${src}$`);
  GLOB_CACHE.set(glob, re);
  return re;
}

/** True when a POSIX path relative to the target matches any of the config `ignore` globs. */
export function isIgnored(rel: string, globs: readonly string[]): boolean {
  return globs.some((g) => globRegex(g).test(rel));
}
