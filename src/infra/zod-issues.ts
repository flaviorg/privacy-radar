import type * as z from "zod";

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; errors?: Issue[][] };

/** `a.b.0.c: <code>` for each issue; unknown keys become path segments. Never the input value. */
function issuePaths(issue: Issue): string[] {
  if (issue.code === "invalid_union" && issue.errors && issue.errors.length > 0) {
    const closest = [...issue.errors].sort((a, b) => a.length - b.length)[0] ?? [];
    return closest.flatMap((inner) => issuePaths({ ...inner, path: [...issue.path, ...inner.path] }));
  }
  if (issue.code === "unrecognized_keys" && issue.keys) {
    return issue.keys.map((k) => `${[...issue.path, k].map(String).join(".")}: ${issue.code}`);
  }
  const path = issue.path.map(String).join(".") || "(root)";
  return [`${path}: ${issue.code}`];
}

/** One line for a Zod error: paths and issue codes only, so a config or catalog error never echoes a value. */
export function describeIssues(error: z.ZodError): string {
  return error.issues.flatMap((i) => issuePaths(i as unknown as Issue)).join("; ");
}
