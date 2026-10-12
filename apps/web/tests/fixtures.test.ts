import assert from "node:assert/strict";
import { test } from "node:test";
import { mockDetail } from "../src/lib/fixtures";

test("mock detail preserves starred RST headings as selectable source sections", async () => {
  const detail = await mockDetail("pep-0649");
  assert.ok(detail);
  const abstract = detail.sections.find(section => section.heading === "Abstract");
  assert.ok(abstract, "PEP 649's Abstract must be a section, not part of Header");
  assert.ok(abstract.text.length > 0);
});

test("mock detail refuses IDs outside the committed corpus", async () => {
  assert.equal(await mockDetail("pep-0749"), null);
  assert.equal(await mockDetail("../../outside-corpus"), null);
});
