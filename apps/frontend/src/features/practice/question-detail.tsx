// PG-STD-QD — Standalone question view (student-safe: answers/explanations are never exposed by the API).
// Deep-linked from Bookmarks and Mistakes; keeps those screens free of 404s during the demo.
"use client";
import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { questionsService } from "@/services";
import { Badge, Card, CardTitle, difficultyTone } from "@/components/ui/card";
import { Breadcrumb } from "@/components/layout/navigation";
import { ErrorState, SkeletonList } from "@/components/ui/states";

export function QuestionDetailPage({ questionId }: { questionId: string }) {
  const { data, loading, error, retry } = useApi(
    () => questionsService.get(questionId),
    [questionId],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-content px-4 py-8 sm:px-8">
        <SkeletonList rows={4} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <ErrorState error={error ?? { code: "UNKNOWN", message: "Question unavailable." }} retry={retry} />
      </div>
    );
  }

  const subject = data.subject;
  const topic = data.topic;

  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-8">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Question" },
        ]}
      />

      <header className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Question preview</h1>
          <p className="mt-1 text-sm text-muted">
            Saved from a practice session — review it, then jump straight into a focused set.
          </p>
        </div>
        <span
          aria-hidden="true"
          className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-ink)]"
        >
          {data.type_code.toUpperCase()}
        </span>
      </header>

      {/* Question body + metadata */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="info">{subject.name}</Badge>
          {topic && <Badge tone="neutral">{topic.name}</Badge>}
          <Badge tone="neutral">GATE {data.gate_year}</Badge>
          <Badge tone={difficultyTone(data.difficulty)}>{data.difficulty}</Badge>
          <Badge tone="neutral">
            {data.marks} mark{data.marks === 1 ? "" : "s"}
          </Badge>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed">{data.body}</p>
      </Card>

      {/* Encouragement + next step */}
      <Card className="mt-4 border-dashed">
        <CardTitle>How would you answer it?</CardTitle>
        <p className="text-sm text-muted">
          Correct answers and explanations are revealed the moment you submit during a practice
          session — attempt this question to see instant grading.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {topic && (
            <Link
              href={`/practice?mode=topic&topic_id=${topic.id}&subject_id=${subject.id}`}
              className="touch-target inline-flex items-center rounded-md2 bg-primary px-4 text-sm font-medium text-white hover:bg-[color:var(--primary-strong)]"
            >
              Practice this topic →
            </Link>
          )}
          <Link
            href="/subjects"
            className="touch-target inline-flex items-center rounded-md2 border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-primary"
          >
            Browse subjects
          </Link>
        </div>
      </Card>
    </div>
  );
}