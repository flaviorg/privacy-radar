import { test } from "node:test";
import assert from "node:assert/strict";
import { codeSpan, escapeMd, tableCell } from "../../src/output/markdown.ts";

/** Removes CommonMark code spans: an opening run of backticks to the next run of the same length. */
const stripCodeSpans = (md: string) => md.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, "");

test("[OUT-09] a crafted name renders inert: no link, image, HTML or mention", () => {
  const md = codeSpan("src/[x](https://e.invalid)`@team`.ts") + " " + escapeMd("![a](b) <img> @team");
  assert.doesNotMatch(stripCodeSpans(md), /\]\(|<img|(^|[^​])@team/);
  assert.doesNotMatch(stripCodeSpans(md), /!\[/);
});

test("[OUT-09] codeSpan uses a longer fence when the text contains backticks", () => {
  assert.equal(codeSpan("a`b"), "``a`b``");
  assert.equal(codeSpan("a``b`c"), "```a``b`c```");
  assert.equal(codeSpan("plain"), "`plain`");
});

test("[OUT-09] codeSpan pads a text that starts or ends with a backtick and flattens newlines", () => {
  assert.equal(codeSpan("`a"), "`` `a ``");
  assert.equal(codeSpan("a`"), "`` a` ``");
  assert.equal(codeSpan("line one\nline two"), "`line one line two`");
});

test("[OUT-09] escapeMd escapes every Markdown control character and breaks mentions", () => {
  assert.equal(escapeMd("a*b_c[d](e)!#|`\\"), "a\\*b\\_c\\[d\\]\\(e\\)\\!\\#\\|\\`\\\\");
  assert.equal(escapeMd("<script>"), "&lt;script&gt;");
  assert.equal(escapeMd("@team and a@b"), "@​team and a@​b");
  assert.equal(escapeMd("two\nlines"), "two lines");
});

test("[OUT-09] tableCell escapes a pipe even inside a code span", () => {
  assert.equal(tableCell(codeSpan("a|b")), "`a\\|b`");
});
