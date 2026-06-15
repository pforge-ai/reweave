import assert from "assert/strict";
import { analyzeHtml } from "../engine/ruleEngine";
import { applyPatchesToSource, createMutationPatches } from "../mutations";

const sample = `<!doctype html>
<html>
<head>
  <title>Quarterly Report</title>
  <style>
    .hero { background: #123c69; color: #ffffff; padding: 40px; }
    .card { border: 1px solid #d0d7de; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>Original title</h1>
      <p>Original description</p>
    </section>
    <section class="cards" style="display: grid; gap: 12px;">
      <article class="card"><h2>Alpha</h2><p>One</p></article>
      <article class="card"><h2>Beta</h2><p>Two</p></article>
      <article class="card"><h2>Gamma</h2><p>Three</p><span class="badge">New</span></article>
    </section>
  </main>
</body>
</html>`;

const ir = analyzeHtml(sample);

assert.equal(ir.version, 2);
assert.ok(ir.stats.componentCount >= 6, "creates a navigable component tree");
assert.equal(ir.stats.repeatGroupCount, 1, "detects repeated card siblings");
assert.equal(ir.docTitle, "Quarterly Report", "extracts the document title");
assert.ok(ir.palette.includes("#123c69"), "extracts the document palette");

const repeatItems = ir.nodes.filter((node) => node.kind === "repeat-item");
assert.equal(repeatItems.length, 3, "groups all three cards even with a structural difference");
assert.ok(repeatItems.every((node) => node.approximate), "marks the relaxed match as approximate");

const firstCard = repeatItems[0];
assert.ok(firstCard.label.includes("Alpha"), `labels repeat items by heading, got: ${firstCard.label}`);
assert.equal(firstCard.repeatCount, 3);

const hero = ir.nodes.find((node) => node.classList.includes("hero"));
assert.ok(hero, "finds the hero section");
assert.ok(hero!.label.includes("Original title"), `labels sections by heading, got: ${hero!.label}`);

// --- setText with repeat sync -------------------------------------------------

const firstCardTitle = firstCard.editable.text.find((slot) => slot.value === "Alpha");
assert.ok(firstCardTitle, "collects direct text slots inside a repeat item");

const syncPatches = createMutationPatches(sample, ir, {
  kind: "setText",
  nodeId: firstCard.id,
  slotId: firstCardTitle!.id,
  value: "Synced",
  sync: true
});
assert.ok(syncPatches && syncPatches.length === 3, "sync edit produces one patch per repeat item");
const synced = applyPatchesToSource(sample, syncPatches!);
assert.equal((synced.match(/<h2>Synced<\/h2>/g) ?? []).length, 3);

// --- setText escaping ---------------------------------------------------------

const textPatches = createMutationPatches(sample, ir, {
  kind: "setText",
  nodeId: firstCard.id,
  slotId: firstCardTitle!.id,
  value: "Delta <safe>"
});
assert.ok(textPatches);
const edited = applyPatchesToSource(sample, textPatches!);
assert.ok(edited.includes("Delta &lt;safe&gt;"));
assert.ok(!edited.includes("<h2>Alpha</h2>"));

// --- stylesheet-derived prop becomes an inline override ------------------------

const heroBackground = hero!.editable.props.find((prop) => prop.key === "background" && prop.origin === "stylesheet");
assert.ok(heroBackground, "exposes stylesheet background as an overridable prop");
const overridePatches = createMutationPatches(sample, ir, {
  kind: "setProp",
  nodeId: hero!.id,
  propId: heroBackground!.id,
  value: "#0a2540"
});
assert.ok(overridePatches);
const overridden = applyPatchesToSource(sample, overridePatches!);
assert.ok(
  overridden.includes('<section class="hero" style="background: #0a2540">'),
  "writes the override as a new inline style attribute"
);

// --- duplicate / delete ---------------------------------------------------------

const duplicatePatches = createMutationPatches(sample, ir, { kind: "duplicateNode", nodeId: firstCard.id });
assert.ok(duplicatePatches);
const duplicated = applyPatchesToSource(sample, duplicatePatches!);
assert.equal((duplicated.match(/class="card"/g) ?? []).length, 4);

const deletePatches = createMutationPatches(sample, ir, { kind: "deleteNode", nodeId: firstCard.id });
assert.ok(deletePatches);
const deleted = applyPatchesToSource(sample, deletePatches!);
assert.equal((deleted.match(/class="card"/g) ?? []).length, 2);

// --- reorder (drag & drop) ------------------------------------------------------

const thirdCard = repeatItems[2];
const reorderPatches = createMutationPatches(sample, ir, {
  kind: "reorderNode",
  nodeId: thirdCard.id,
  targetId: firstCard.id,
  position: "before"
});
assert.ok(reorderPatches, "reorder maps to source patches");
const reordered = applyPatchesToSource(sample, reorderPatches!);
const alphaIndex = reordered.indexOf("<h2>Alpha</h2>");
const gammaIndex = reordered.indexOf("<h2>Gamma</h2>");
assert.ok(gammaIndex !== -1 && gammaIndex < alphaIndex, "third card moves before the first");
assert.equal((reordered.match(/class="card"/g) ?? []).length, 3, "reorder keeps the same number of cards");

// --- determinism ----------------------------------------------------------------

const second = analyzeHtml(sample);
assert.deepEqual(
  second.nodes.map((node) => [node.id, node.label, node.source.start, node.source.end]),
  ir.nodes.map((node) => [node.id, node.label, node.source.start, node.source.end]),
  "analysis is deterministic"
);

console.log("ruleEngine.test.ts passed");
