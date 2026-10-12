import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Schema } from "./contracts";

const root = path.resolve(process.cwd(), "../..");
export async function readFixture<T>(name: string): Promise<T> {
  // Callers supply constant, allowlisted fixture names, never request paths.
  return JSON.parse(await readFile(path.join(root, "packages/contracts/fixtures", `${name}.json`), "utf8")) as T;
}

export async function snapshotDate(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(root, "data/peps/manifest.json"), "utf8"));
  return manifest.fetched_at;
}

export async function mockDetail(id: string): Promise<Schema<"DecisionDetail"> | null> {
  const list = await readFixture<Schema<"DecisionList">>("decisions");
  const doc = list.documents.find(doc => doc.doc_id === id);
  if (!doc) return null;
  if (id === "pep-0386") return readFixture<Schema<"DecisionDetail">>("decision_pep-0386");
  const body_text = await readFile(path.join(root, "data/peps", `${doc.doc_id}.rst`), "utf8");
  const lines = body_text.split("\n");
  const sections: Schema<"Section">[] = [];
  let heading = "Header";
  let start = 0;
  const adornment = /^([=\-~^*+#])\1{2,}$/;
  for (let i = 1; i < lines.length; i++) {
    if (adornment.test(lines[i]) && lines[i - 1].trim() && !adornment.test(lines[i - 1])) {
      const end = adornment.test(lines[i - 2] ?? "") ? i - 2 : i - 1;
      sections.push({ heading, locator: heading, text: lines.slice(start, end).join("\n").trim() });
      heading = lines[i - 1].trim();
      start = i + 1;
    }
  }
  sections.push({ heading, locator: heading, text: lines.slice(start).join("\n").trim() });
  return { ...doc, body_text, sections };
}
