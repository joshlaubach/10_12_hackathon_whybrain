// Type-checks that every JSON fixture is assignable to the generated types.
// Run: npm run check
import type { components } from "./api";
type C = components["schemas"];

import decisions from "../fixtures/decisions.json";
import detail from "../fixtures/decision_pep-0386.json";
import health from "../fixtures/health.json";
import ask from "../fixtures/stream_ask_386_440.json";
import unsupported from "../fixtures/stream_ask_unsupported.json";
import missing from "../fixtures/stream_ask_missing_successor_563.json";
import review from "../fixtures/stream_review_proposal.json";
import err from "../fixtures/stream_error_model_unavailable.json";
import draftPending from "../fixtures/draft_pending.json";
import draftIndexed from "../fixtures/draft_indexed.json";
import draftLocal from "../fixtures/draft_indexed_local.json";
import draftFailed from "../fixtures/draft_failed.json";
import conflict from "../fixtures/draft_conflict.json";
import createReq from "../fixtures/draft_create_request.json";

export const checks = {
  decisions: decisions as C["DecisionList"],
  detail: detail as C["DecisionDetail"],
  health: health as C["HealthResponse"],
  streams: [ask, unsupported, missing, review, err] as C["StreamEvent"][][],
  drafts: [draftPending, draftIndexed, draftLocal, draftFailed] as C["DraftRecord"][],
  conflict: conflict as C["ErrorBody"],
  createReq: createReq as C["DraftCreateRequest"],
};
