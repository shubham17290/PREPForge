// PHASE 8 — Practice sessions API (Phase 4 §2.4, §3.2.5–3.2.8, §8)
import { Router } from "express";
import { requireAuth } from "../../core/middleware/auth";
import { DIFFICULTIES, PRACTICE_MODE_CODES, QUESTION_TYPE_CODES } from "../../core/config/env";
import { isUuid, Validator } from "../../core/validation/schema";
import { errors } from "../../core/errors";
import * as practiceService from "../../core/services/practice.service";
import { asyncHandler, ok } from "../../core/utils/http";

export const practiceRouter = Router();

function sessionIdOr404(value: string | undefined): string {
  if (!value || !isUuid(value)) throw errors.notFound("SESSION_NOT_FOUND", "Practice session not found.");
  return value;
}

practiceRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    v.strictKeys(["mode", "filters", "timed", "question_count"]);
    const mode = v.enumOf("mode", PRACTICE_MODE_CODES, { required: true });
    const timed = v.boolean("timed") ?? false;
    const questionCount = v.int("question_count", { min: 1, max: 50 }) ?? undefined;
    v.finish();

    // filters object (required): strict inner keys.
    if (typeof req.body !== "object" || req.body === null) throw errors.malformed();
    const body = req.body as Record<string, unknown>;
    const rawFilters = body["filters"];
    if (typeof rawFilters !== "object" || rawFilters === null || Array.isArray(rawFilters)) {
      throw errors.validation([{ field: "filters", code: "VALIDATION_REQUIRED", message: '"filters" object is required.' }]);
    }
    const fv = new Validator(rawFilters);
    fv.strictKeys(["subject_id", "topic_id", "year", "difficulty", "question_types"]);
    const subjectId = fv.uuid("subject_id");
    const topicId = fv.uuid("topic_id");
    const year = fv.int("year", { min: 1990 });
    const difficulty = fv.enumOf("difficulty", DIFFICULTIES);
    const questionTypes = fv.stringArray("question_types", { minItems: 1, unique: true });
    fv.finish();
    for (const code of questionTypes ?? []) {
      if (!(QUESTION_TYPE_CODES as readonly string[]).includes(code)) {
        throw errors.validation([
          { field: "filters.question_types", code: "VALIDATION_INVALID_VALUE", message: "Question type codes must be mcq, msq or nat." },
        ]);
      }
    }

    const data = await practiceService.createSession(req.principal?.id as string, {
      mode: mode as string,
      filters: {
        ...(subjectId ? { subject_id: subjectId } : {}),
        ...(topicId ? { topic_id: topicId } : {}),
        ...(year !== undefined ? { year } : {}),
        ...(difficulty ? { difficulty } : {}),
        ...(questionTypes ? { question_types: questionTypes } : {}),
      },
      timed,
      questionCount: questionCount ?? 20,
    });
    ok(res, 201, data);
  }),
);

practiceRouter.post(
  "/:id/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, 200, await practiceService.startSession(sessionIdOr404(req.params["id"]), req.principal?.id as string));
  }),
);

practiceRouter.post(
  "/:id/attempts",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = sessionIdOr404(req.params["id"]);

    const v = new Validator(req.body);
    v.strictKeys(["question_id", "answer", "time_taken_seconds"]);
    const questionId = v.uuid("question_id", { required: true });
    const timeTaken = v.int("time_taken_seconds", { required: true, min: 0, max: 3600 });
    v.finish();

    const body = req.body as Record<string, unknown>;
    const answer = body["answer"];
    if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
      throw errors.validation([{ field: "answer", code: "VALIDATION_INVALID_ANSWER", message: '"answer" must be an object.' }]);
    }

    const result = await practiceService.recordAttempt(sessionId, req.principal?.id as string, {
      question_id: questionId as string,
      answer: answer as Record<string, unknown>,
      time_taken_seconds: timeTaken as number,
    });
    ok(res, result.created ? 201 : 200, result.payload);
  }),
);

practiceRouter.post(
  "/:id/complete",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = sessionIdOr404(req.params["id"]);

    // unanswered_policy accepted but server-authoritative per OD-06 ("skipped").
    const v = new Validator(req.body ?? {});
    v.strictKeys(["unanswered_policy"]);
    const policy = v.string("unanswered_policy");
    v.finish();
    if (policy !== undefined && policy !== "skipped") {
      throw errors.validation([
        { field: "unanswered_policy", code: "VALIDATION_INVALID_VALUE", message: 'Only "skipped" is supported (OD-06).' },
      ]);
    }

    ok(res, 200, await practiceService.completeSession(sessionId, req.principal?.id as string));
  }),
);

practiceRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, 200, await practiceService.getSessionState(sessionIdOr404(req.params["id"]), req.principal?.id as string));
  }),
);

practiceRouter.get(
  "/:id/questions",
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, 200, await practiceService.getSessionQuestions(sessionIdOr404(req.params["id"]), req.principal?.id as string));
  }),
);

practiceRouter.get(
  "/:id/result",
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, 200, await practiceService.getResult(sessionIdOr404(req.params["id"]), req.principal?.id as string));
  }),
);
