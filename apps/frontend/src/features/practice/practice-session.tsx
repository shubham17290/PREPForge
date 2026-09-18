"use client";
// PG-STD-PRAC — Active practice: solve, palette, timer, bookmark, complete (Phase 5 §7–8).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { practiceService, questionsService, studentService } from "@/services";
import type { AttemptResponse, PublicQuestion, SessionState } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Badge, difficultyTone, SegmentProgress } from "@/components/ui/card";
import { ErrorState, Spinner } from "@/components/ui/states";
import { Modal, useToast } from "@/components/ui/overlay";
import { formatSeconds } from "@/utils/format";
import { QuestionOptions } from "./question-options";

type AnswerDraft = Record<string, unknown> | null;

export function PracticeSessionPage({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { notify } = useToast();

  const [state, setState] = useState<SessionState | null>(null);
  const [meta, setMeta] = useState<Record<string, PublicQuestion>>({});
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const [current, setCurrent] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [results, setResults] = useState<Record<string, AttemptResponse>>({});
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [bookmarksByQuestion, setBookmarksByQuestion] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [notLive, setNotLive] = useState<"completed" | "abandoned" | null>(null);

  const questionStartRef = useRef<number>(0);
  const [now, setNow] = useState(0);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let sessionState: SessionState;
      try {
        // Start is idempotent while live; builds the server-side pool on first call.
        sessionState = await practiceService.start(sessionId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          sessionState = await practiceService.state(sessionId);
          if (sessionState.status !== "in_progress") {
            setNotLive(sessionState.status === "abandoned" ? "abandoned" : "completed");
            setState(sessionState);
            return;
          }
        }
        throw error;
      }

      // Fallback: backend may return SessionDTO without questions/attempts (legacy contract).
      // If questions missing, fetch via dedicated questions endpoint and map backend DTO → frontend SessionQuestion.
      let normalizedQuestions: SessionState["questions"] = (sessionState.questions as unknown as SessionState["questions"] | undefined) ?? [];
      const rawQuestions = sessionState.questions as unknown as Array<Record<string, unknown>> | undefined;
      const needsFetch = !Array.isArray(rawQuestions) || rawQuestions.length === 0;
      if (needsFetch) {
        try {
          const fetched = await practiceService.questions(sessionId);
          // Map backend SessionQuestionDTO (questionId, questionType, etc.) → frontend SessionQuestion (id, type_code, gate_year)
          normalizedQuestions = (fetched as unknown as Array<Record<string, unknown>>).map((q) => ({
            id: (q.id ?? q.questionId ?? q.question_id) as string,
            body: q.body as string,
            type_code: (q.type_code ?? q.questionType ?? "mcq") as SessionState["questions"][number]["type_code"],
            marks: q.marks as number,
            difficulty: q.difficulty as string,
            gate_year: (q.gate_year ?? (q as Record<string, unknown>).gateYear ?? 2099) as number,
            options: (q.options as SessionState["questions"][number]["options"]) ?? [],
          })) as unknown as SessionState["questions"];
          // Patch sessionState for downstream
          (sessionState as unknown as Record<string, unknown>).questions = normalizedQuestions;
        } catch {
          normalizedQuestions = [];
        }
      } else if (rawQuestions && rawQuestions.length > 0 && !(rawQuestions[0] as Record<string, unknown>).id) {
        // Normalize shape: backend may use questionId / questionType
        normalizedQuestions = rawQuestions.map((q) => ({
          id: (q.id ?? q.questionId ?? q.question_id) as string,
          body: q.body as string,
          type_code: (q.type_code ?? q.questionType ?? "mcq") as SessionState["questions"][number]["type_code"],
          marks: q.marks as number,
          difficulty: q.difficulty as string,
          gate_year: (q.gate_year ?? (q as Record<string, unknown>).gateYear ?? 2099) as number,
          options: (q.options as SessionState["questions"][number]["options"]) ?? [],
        })) as unknown as SessionState["questions"];
        (sessionState as unknown as Record<string, unknown>).questions = normalizedQuestions;
      }

      const attemptsArray = (sessionState.attempts as unknown as SessionState["attempts"] | undefined) ?? [];
      setState({ ...sessionState, questions: normalizedQuestions, attempts: attemptsArray } as SessionState);

      const resultsMap: Record<string, AttemptResponse> = {};
      for (const attempt of attemptsArray) {
        if (attempt.question_id) {
          resultsMap[attempt.question_id] = {
            attempt_id: attempt.attempt_id,
            question_id: attempt.question_id,
            is_correct: attempt.is_correct,
            marks: attempt.marks,
            time_taken_seconds: attempt.time_taken_seconds,
          };
        }
      }
      setResults(resultsMap);

      // Enrich header badges (subject/topic) from public question details.
      const details = await Promise.allSettled(
        (normalizedQuestions as unknown as Array<{ id: string }>).map((item) => questionsService.get((item as unknown as { id: string }).id))
      );
      const metaMap: Record<string, PublicQuestion> = {};
      details.forEach((entry) => {
        if (entry.status === "fulfilled") metaMap[entry.value.id] = entry.value;
      });
      setMeta(metaMap);
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error : new ApiError(500, "UNKNOWN", "Unexpected error.")
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void bootstrap(), 0);
    void studentService
      .bookmarks(1)
      .then((page) => {
        const map: Record<string, string> = {};
        for (const item of page.items ?? []) map[item.question.id] = item.id;
        setBookmarksByQuestion(map);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed timer ticks every second while the session is live (server anchor).
  useEffect(() => {
    if (!state || state.status !== "in_progress") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state]);

  const elapsedSeconds = useMemo(() => {
    if (!state) return 0;
    return Math.max(0, Math.floor((now - new Date(state.started_at).getTime()) / 1000));
  }, [state, now]);

  useEffect(() => {
    questionStartRef.current = Date.now();
  }, [current]);

  async function persistAnswer() {
    if (!state || !question) return;
    const qid = (question as unknown as Record<string, unknown>).id ?? (question as unknown as Record<string, unknown>).questionId;
    const draft = drafts[qid as string];
    if (!draft) {
      notify("Select an answer first", "error");
      return;
    }
    setSaving(true);
    try {
      const elapsed = Math.min(
        3600,
        Math.max(0, Math.floor((now - questionStartRef.current) / 1000))
      );
      const sid = (state as unknown as Record<string, unknown>).session_id ?? (state as unknown as Record<string, unknown>).id ?? (state as unknown as Record<string, unknown>).sessionId;
      const result = await practiceService.attempt(sid as string, {
        question_id: qid as string,
        answer: draft as Record<string, unknown>,
        time_taken_seconds: elapsed,
      });
      setResults((currentResults) => ({ ...currentResults, [question.id]: result }));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      notify(
        result.is_correct
          ? "Correct! 🎉"
          : result.marks > 0
            ? `Saved — partial credit (+${result.marks})`
            : "Saved — incorrect",
        result.is_correct ? "success" : "error"
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT_SESSION_NOT_LIVE")
        setNotLive("completed");
      else notify(error instanceof ApiError ? error.message : "Could not save answer.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleBookmark() {
    if (!question) return;
    try {
      const existingId = bookmarksByQuestion[question.id];
      if (existingId) {
        await studentService.removeBookmark(existingId);
        setBookmarksByQuestion((current) => {
          const next = { ...current };
          delete next[question.id];
          return next;
        });
        notify("Bookmark removed", "info");
      } else {
        const created = await studentService.addBookmark(question.id);
        setBookmarksByQuestion((current) => ({ ...current, [created.question_id]: created.id }));
        notify("Bookmarked ⭐", "success");
      }
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Bookmark failed", "error");
    }
  }

  async function onComplete() {
    if (!state) return;
    setCompleting(true);
    try {
      await practiceService.complete(state.session_id);
      router.push(`/results/${state.session_id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT_SESSION_NOT_LIVE") {
        setNotLive("completed");
        setConfirmOpen(false);
      } else {
        notify(error instanceof ApiError ? error.message : "Could not submit session.", "error");
      }
      setCompleting(false);
    }
  }

  if (loading) return <Spinner label="Preparing your questions" />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorState error={loadError} retry={() => void bootstrap()} />
      </div>
    );
  }

  if (notLive) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-4xl" aria-hidden="true">
          {notLive === "abandoned" ? "⏸" : "✅"}
        </p>
        <h1 className="mt-3 text-xl font-bold">
          {notLive === "abandoned"
            ? "This session was abandoned"
            : "This session is already completed"}
        </h1>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            href="/practice"
            className="touch-target inline-flex items-center rounded-md2 border border-line bg-surface px-4 font-medium"
          >
            New session
          </Link>
          <Link
            href={`/results/${sessionId}`}
            className="touch-target inline-flex items-center rounded-md2 bg-primary px-4 font-medium text-white"
          >
            View result
          </Link>
        </div>
      </div>
    );
  }

  const questions = state?.questions ?? [];
  const question = questions[current];
  const answeredCount = Object.keys(results).length;

  if (!question) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-muted">
        This session has no questions.{" "}
        <Link className="font-medium text-primary" href="/practice">
          Set up a new one.
        </Link>
      </div>
    );
  }

  const draft = drafts[question.id];
  const graded = results[question.id];
  const isLocked = state?.status !== "in_progress";
  const questionMeta = meta[question.id];

  function goTo(index: number) {
    setCurrent(Math.min(questions.length - 1, Math.max(0, index)));
  }

  return (
    <div className="mx-auto flex max-w-content flex-col px-4 pb-28 sm:px-8">
      {/* Sticky header: counter + timer + bookmark + segment progress */}
      <header className="sticky top-[57px] z-20 -mx-4 mb-4 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex items-center justify-between gap-3 py-1">
          <p aria-live="polite" className="text-sm font-semibold">
            Question {current + 1} of {questions.length}
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 font-mono text-sm font-semibold ${
                state?.timed ? "bg-danger-soft text-danger" : "bg-gray-100 text-muted"
              }`}
              data-testid="timer"
            >
              ⏱ {formatSeconds(elapsedSeconds)}
            </span>
            <button
              type="button"
              onClick={() => void toggleBookmark()}
              aria-label={
                bookmarksByQuestion[question.id] ? "Remove bookmark" : "Bookmark this question"
              }
              aria-pressed={Boolean(bookmarksByQuestion[question.id])}
              className="touch-target rounded-md2 border border-line bg-surface px-2 text-lg"
            >
              {bookmarksByQuestion[question.id] ? "★" : "☆"}
            </button>
          </div>
        </div>
        <SegmentProgress
          states={questions.map((item) => {
            if (marked.has(item.id)) return "marked";
            const itemResult = results[item.id];
            if (!itemResult) return "unanswered";
            return itemResult.is_correct ? "correct" : "incorrect";
          })}
        />
      </header>

      {/* Meta badges row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {questionMeta && <Badge tone="info">{questionMeta.subject.name}</Badge>}
        {questionMeta?.topic && <Badge tone="neutral">{questionMeta.topic.name}</Badge>}
        <Badge tone="neutral">GATE {question.gate_year}</Badge>
        <Badge tone={difficultyTone(question.difficulty)}>{question.difficulty}</Badge>
        <Badge tone="neutral">{question.type_code.toUpperCase()}</Badge>
        <Badge tone={question.marks >= 2 ? "warning" : "neutral"}>
          {question.marks} mark{question.marks === 1 ? "" : "s"}
        </Badge>
        {graded && (
          <Badge tone={graded.is_correct ? "success" : graded.marks > 0 ? "warning" : "danger"}>
            {graded.is_correct
              ? "✓ Correct"
              : graded.marks > 0
                ? `◐ Partial +${graded.marks}`
                : "✗ Incorrect"}
          </Badge>
        )}
        {marked.has(question.id) && <Badge tone="warning">⚑ Marked</Badge>}
      </div>

      {/* Question body */}
      <main className="mt-4 rounded-md2 border border-line bg-surface p-5 shadow-low">
        <p className="whitespace-pre-wrap text-base leading-relaxed">{question.body}</p>
        <div className="mt-6">
          <QuestionOptions
            question={question}
            disabled={isLocked}
            selected={draft ?? null}
            onSelect={(answer) =>
              setDrafts((currentDrafts) => ({ ...currentDrafts, [question.id]: answer }))
            }
            gradedResult={graded ?? null}
          />
        </div>
        {graded && (
          <p
            role="status"
            className={`mt-4 rounded-md2 px-3 py-2 text-sm font-medium ${graded.is_correct ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
          >
            {graded.is_correct
              ? `Correct — +${graded.marks} marks`
              : graded.marks > 0
                ? `Partially correct — +${graded.marks} marks (full marks need the exact correct set)`
                : `Incorrect — ${graded.marks} marks`}
          </p>
        )}
      </main>

      {/* Per-question actions */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() =>
            setMarked((currentMarked) => {
              const nextMarked = new Set(currentMarked);
              if (nextMarked.has(question.id)) nextMarked.delete(question.id);
              else nextMarked.add(question.id);
              return nextMarked;
            })
          }
          aria-pressed={marked.has(question.id)}
          className={`touch-target inline-flex items-center justify-center gap-1.5 rounded-md2 border px-4 text-sm font-medium ${
            marked.has(question.id)
              ? "border-warning bg-warning-soft text-warning"
              : "border-line bg-surface text-muted"
          }`}
        >
          ⚑ {marked.has(question.id) ? "Marked for review" : "Mark for review"}
        </button>
        <Button onClick={() => void persistAnswer()} loading={saving} disabled={isLocked}>
          {graded ? "Update answer" : "Save answer"}
        </Button>
      </div>
      <p aria-live="polite" className="mt-1 h-5 text-xs font-medium text-success">
        {savedFlash ? "Answer saved ✓" : ""}
      </p>

      {/* Navigation bar: sticky bottom on mobile (Phase 5 §11) */}
      <nav
        aria-label="Question navigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-2 backdrop-blur sm:static sm:mt-6 sm:border-0 sm:bg-transparent sm:px-0"
      >
        <div className="mx-auto flex max-w-content items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={current === 0}
            onClick={() => goTo(current - 1)}
          >
            ← Prev
          </Button>
          <Palette
            total={questions.length}
            current={current}
            ids={questions.map((item) => item.id)}
            isMarked={(id) => marked.has(id)}
            isGraded={(id) => results[id]}
            onGo={goTo}
          />
          {current < questions.length - 1 ? (
            <Button size="sm" onClick={() => goTo(current + 1)}>
              Next →
            </Button>
          ) : (
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={completing}>
              Finish ✓
            </Button>
          )}
        </div>
      </nav>

      <Modal open={confirmOpen} title="Submit session?" onClose={() => setConfirmOpen(false)}>
        <p className="text-sm text-muted">
          You answered <strong>{answeredCount}</strong> of <strong>{questions.length}</strong>{" "}
          questions.
          {questions.length - answeredCount > 0 && (
            <>
              {" "}
              <strong className="text-warning">
                {questions.length - answeredCount} unanswered
              </strong>{" "}
              — they will be skipped and not scored.
            </>
          )}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Keep solving
          </Button>
          <Button loading={completing} onClick={() => void onComplete()}>
            Submit &amp; view result
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Palette({
  total,
  current,
  ids,
  isMarked,
  isGraded,
  onGo,
}: {
  total: number;
  current: number;
  ids: string[];
  isMarked: (id: string) => boolean;
  isGraded: (id: string) => AttemptResponse | undefined;
  onGo: (index: number) => void;
}) {
  return (
    <ol className="flex flex-1 flex-wrap justify-center gap-1" aria-label="Question palette">
      {Array.from({ length: total }).map((_, index) => {
        const id = ids[index];
        const itemResult = id ? isGraded(id) : undefined;
        const stateClass =
          id && isMarked(id)
            ? "border-warning bg-warning-soft text-warning"
            : itemResult
              ? itemResult.is_correct
                ? "border-success bg-success-soft text-success"
                : "border-danger bg-danger-soft text-danger"
              : "border-line bg-surface text-muted";
        return (
          <li key={id ?? index}>
            <button
              type="button"
              onClick={() => onGo(index)}
              aria-label={`Question ${index + 1}${itemResult ? (itemResult.is_correct ? ", correct" : ", incorrect") : isMarked(id) ? ", marked for review" : ", unanswered"}`}
              aria-current={index === current || undefined}
              className={`size-9 rounded-md2 border text-xs font-semibold transition-transform ${stateClass} ${
                index === current ? "ring-2 ring-primary ring-offset-1" : ""
              }`}
            >
              {index + 1}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
