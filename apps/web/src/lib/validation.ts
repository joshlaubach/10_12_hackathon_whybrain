import Ajv2020 from "ajv/dist/2020";
import streamSchema from "@contracts/schemas/StreamEvent.json";
import healthSchema from "@contracts/schemas/HealthResponse.json";
import listSchema from "@contracts/schemas/DecisionList.json";
import detailSchema from "@contracts/schemas/DecisionDetail.json";
import draftSchema from "@contracts/schemas/DraftRecord.json";
import errorSchema from "@contracts/schemas/ErrorBody.json";
import type { Schema } from "./contracts";

const ajv = new Ajv2020({ strict: false });
export const validateEvent = ajv.compile<Schema<"StreamEvent">>(streamSchema);
export const validateHealth = ajv.compile<Schema<"HealthResponse">>(healthSchema);
export const validateList = ajv.compile<Schema<"DecisionList">>(listSchema);
export const validateDetail = ajv.compile<Schema<"DecisionDetail">>(detailSchema);
export const validateDraft = ajv.compile<Schema<"DraftRecord">>(draftSchema);
export const validateError = ajv.compile<Schema<"ErrorBody">>(errorSchema);
