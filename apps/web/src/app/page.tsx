import type { Schema } from "@/lib/contracts";
import { readFixture, snapshotDate } from "@/lib/fixtures";
import { Workspace } from "@/components/workspace";

export const dynamic = "force-dynamic";
export default async function Page() {
  const [initialList, initialHealth, events, date] = await Promise.all([
    readFixture<Schema<"DecisionList">>("decisions"),
    readFixture<Schema<"HealthResponse">>("health"),
    readFixture<Schema<"StreamEvent">[]>("stream_ask_386_440"),
    snapshotDate(),
  ]);
  const initialAnswer = events.find(event => event.type === "answer_completed");
  if (!initialAnswer) throw new Error("The initial answer fixture is missing.");
  return <Workspace initialList={initialList} initialHealth={initialHealth} initialAnswer={initialAnswer} snapshotDate={date} />;
}
