import { test } from "node:test";
import assert from "node:assert/strict";
import { inventorySchema } from "../../src/contracts/inventory.ts";
import { buildInventory, renderInventoryMd, type InventoryLabel } from "../../src/output/inventory.ts";
import { buildModelFromTexts } from "../helpers/builders.ts";

const SCHEMA = `model Patient {
  id        Int      @id
  cpf       String?
  diagnosis String
  birthDate DateTime @db.Date
  guardianName String?
  obs       Json?
  createdAt DateTime
  @@map("patients")
}
model Clinic {
  cnpj String
  name String
}
`;
const CODE = `import type { Patient } from "@prisma/client";
export function f(p: Patient) { console.log(p.cpf); }
export async function g() { await fetch("https://api.mixpanel.com/track", { method: "POST", body: JSON.stringify({ cpf: "x" }) }); }
`;

const model = () => buildModelFromTexts({ "prisma/schema.prisma": SCHEMA, "src/a.ts": CODE });

test("inventory counts every field once and classifies its status", () => {
  const inv = buildInventory(model(), [], []);
  inventorySchema.parse(inv);
  assert.equal(inv.counts.entities, 2);
  assert.equal(inv.counts.fields, 9);
  const patient = inv.entities.find((e) => e.name === "Patient")!;
  const status = Object.fromEntries(patient.fields.map((f) => [f.name, f.status]));
  assert.deepEqual(status, { id: "unclassified", cpf: "personal", diagnosis: "personal", birthDate: "personal", guardianName: "personal", obs: "ambiguous", createdAt: "unclassified" });
  const clinic = inv.entities.find((e) => e.name === "Clinic")!;
  assert.equal(clinic.fields.find((f) => f.name === "cnpj")!.status, "not-personal");
  assert.equal(clinic.fields.find((f) => f.name === "name")!.status, "below-threshold");
  const c = inv.counts;
  assert.equal(c.personal + c.notPersonal + c.belowThreshold + c.ambiguous + c.unclassified, c.fields);
  assert.equal(c.sensitive, 1);
  assert.equal(c.childrenIndicators, 2);
});

test("entity flags come from deterministic candidates and the config", () => {
  const inv = buildInventory(model(), [], []);
  const patient = inv.entities.find((e) => e.name === "Patient")!;
  assert.equal(patient.flags.hasSensitive, true);
  assert.equal(patient.flags.hasChildrenIndicator, true);
  assert.equal(patient.flags.retentionSignal, null);
  assert.equal(inv.entities.find((e) => e.name === "Clinic")!.flags.hasSensitive, false);
  const withConfig = buildInventory(buildModelFromTexts({ "prisma/schema.prisma": SCHEMA }, { config: { schemaVersion: 1, retention: { Patient: "5 years after the last visit" } } }), [], []);
  assert.equal(withConfig.entities.find((e) => e.name === "Patient")!.flags.retentionSignal, "5 years after the last visit");
});

test("sinks reached by a field and the hosts of http sinks are listed", () => {
  const inv = buildInventory(model(), [], []);
  const cpf = inv.entities.find((e) => e.name === "Patient")!.fields.find((f) => f.name === "cpf")!;
  assert.ok(cpf.sinks.some((s) => s.kind === "log" && s.callee === "console.log" && s.file === "src/a.ts" && s.line === 2), JSON.stringify(cpf.sinks));
  assert.deepEqual(inv.hosts, [{ host: "api.mixpanel.com", vendor: "Mixpanel", hqCountry: "US" }]);
});

test("an LLM label sits in its own key and never changes status, categories or counts", () => {
  const base = buildInventory(model(), [], []);
  const label: InventoryLabel = { entity: "Patient", field: "obs", label: "special.health", confidence: 0.62, scripted: true, rationale: "RATIONALE-MARKER" };
  const labeled = buildInventory(model(), [], [label]);
  const obs = labeled.entities.find((e) => e.name === "Patient")!.fields.find((f) => f.name === "obs")!;
  assert.deepEqual(obs.llmLabel, { label: "special.health", confidence: 0.62, scripted: true, rationale: "RATIONALE-MARKER" });
  assert.equal(obs.status, "ambiguous");
  assert.deepEqual(obs.categories, []);
  assert.deepEqual(labeled.counts, base.counts);
  assert.deepEqual(
    labeled.entities.map((e) => e.fields.map(({ llmLabel: _l, ...rest }) => rest)),
    base.entities.map((e) => e.fields.map(({ llmLabel: _l, ...rest }) => rest)),
  );
});

test("[OUT-09] inventory.md never contains an LLM rationale and shows only the label and confidence", () => {
  const label: InventoryLabel = { entity: "Patient", field: "obs", label: "special.health", confidence: 0.62, scripted: true, rationale: "RATIONALE-MARKER" };
  const md = renderInventoryMd(buildInventory(model(), [], [label]));
  assert.ok(!md.includes("RATIONALE-MARKER"));
  assert.ok(md.includes("`special.health` (0.62, scripted)"));
  assert.ok(md.includes("LLM label (advisory)"));
});

test("[OUT-09] a crafted entity name and file path render inert in inventory.md", () => {
  const evil = buildModelFromTexts({ "src/[x](https://e.invalid)@team.ts": "export interface Patient { cpf: string; }\n" });
  const md = renderInventoryMd(buildInventory(evil, [], []));
  assert.doesNotMatch(md.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, ""), /\]\(|<img|@team/);
});

test("inventory.md carries the disclaimer and a table header for every entity", () => {
  const md = renderInventoryMd(buildInventory(model(), [], []));
  assert.ok(md.includes("This is not legal advice and not a complete assessment."));
  assert.equal(md.match(/^\| Field \| Categories \| Sensitivity \| Confidence \| Sinks reached \| Locations \| LLM label \(advisory\) \|$/gm)?.length, 2);
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
});
