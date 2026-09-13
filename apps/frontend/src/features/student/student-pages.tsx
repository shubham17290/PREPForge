"use client";
// PG-STD-BKM / PG-STD-MIST / PG-STD-PRF(profile) — student lists + profile view.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { questionsService, studentService, subjectsService } from "@/services";
import type { PaginationMeta, PublicQuestion } from "@/types/api";
import { Card } from "@/components/ui/card";
import { Badge, difficultyTone } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/states";
import { Breadcrumb } from "@/components/layout/navigation";
import { useToast } from "@/components/ui/overlay";
import { formatDate } from "@/utils/format";

export function BookmarksPage() {
  const [page, setPage] = useState(1);
  const router = useRouter();
  const { notify } = useToast();
  const { data, loading, error, retry } = useApi(() => studentService.bookmarks(page), [page]);

  async function onRemove(bookmarkId: string) {
    try {
      await studentService.removeBookmark(bookmarkId);
      notify("Bookmark removed", "info");
      retry();
    } catch (removeError) {
      notify(
        removeError instanceof ApiError ? removeError.message : "Could not remove bookmark.",
        "error"
      );
    }
  }

  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-8">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bookmarks" }]} />
      <h1 className="mb-6 mt-3 text-2xl font-bold">Bookmarks</h1>

      {loading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorState error={error} retry={retry} />
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState
          icon="⭐"
          message="No bookmarks yet — star questions while practicing."
          cta="Start practice"
          onCta={() => router.push("/practice")}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {(data?.items ?? []).map((bookmark) => (
              <li key={bookmark.id}>
                <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium">{bookmark.question.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">{bookmark.question.subject.name}</Badge>
                      {bookmark.question.topic && (
                        <Badge tone="neutral">{bookmark.question.topic.name}</Badge>
                      )}
                      <Badge tone={difficultyTone(bookmark.question.difficulty)}>
                        {bookmark.question.difficulty}
                      </Badge>
                      <span className="text-xs text-muted">
                        Saved {formatDate(bookmark.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href={`/questions/${bookmark.question.id}`}
                      className="touch-target inline-flex items-center rounded-md2 border border-line px-3 text-sm font-medium hover:border-primary"
                    >
                      Open
                    </Link>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onRemove(bookmark.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pager meta={data?.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export function MistakesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const details = useApi(async () => {
    const list = await studentService.mistakes(1);
    const ids = (list.items ?? []).slice(0, 12).map((item) => item.question_id);
    const settled = await Promise.allSettled(ids.map((id) => questionsService.get(id)));
    return settled
      .filter(
        (entry): entry is PromiseFulfilledResult<PublicQuestion> => entry.status === "fulfilled"
      )
      .map((entry) => entry.value);
  }, []);

  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-8">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Mistakes" }]} />
      <div className="mt-3 mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Mistake review</h1>
        <Link
          href="/practice?mode=mistake"
          className="touch-target inline-flex items-center rounded-md2 bg-primary px-4 text-sm font-medium text-white"
        >
          Practice mistakes →
        </Link>
      </div>

      {details.loading ? (
        <SkeletonList rows={4} />
      ) : details.error ? (
        <ErrorState error={details.error} retry={details.retry} />
      ) : (details.data ?? []).length === 0 ? (
        <EmptyState
          icon="✨"
          message="No mistakes — keep it up!"
          cta="Practice more"
          onCta={() => router.push("/practice")}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {(details.data ?? []).map((question) => (
            <li key={question.id}>
              <Link href={`/questions/${question.id}`} className="group block h-full">
                <Card className="h-full transition-shadow group-hover:shadow-med">
                  <p className="line-clamp-3">{question.body}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="info">{question.type_code.toUpperCase()}</Badge>
                    <Badge tone="neutral">GATE {question.gate_year}</Badge>
                    <Badge tone={difficultyTone(question.difficulty)}>{question.difficulty}</Badge>
                    {question.topic && <Badge tone="neutral">{question.topic.name}</Badge>}
                  </div>
                  <span className="mt-3 inline-flex touch-target items-center gap-1 text-sm font-medium text-[color:var(--accent)]">
                    Open question →
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const subjects = useApi(() => subjectsService.list(), []);
  const targetSubject = user?.target_subject_id
    ? (subjects.data?.items ?? []).find((subject) => subject.id === user.target_subject_id)
    : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-8">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Profile" }]} />
      <h1 className="mb-6 mt-3 text-2xl font-bold">Your profile</h1>
      <Card>
        <dl className="divide-y divide-line">
          <Row label="Full name" value={user?.full_name ?? "—"} />
          <Row label="Email" value={user?.email ?? "—"} />
          <Row label="Role" value={user?.role ?? "—"} />
          <Row
            label="Target subject"
            value={targetSubject?.name ?? (user?.target_subject_id ? "—" : "Not set")}
          />
          <Row label="Member since" value={formatDate(user?.created_at)} />
        </dl>
        <p className="mt-4 rounded-md2 bg-warning-soft px-3 py-2 text-xs text-warning" role="note">
          Profile editing is not available in this release — the backend does not expose a
          profile-update endpoint yet.
        </p>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="text-sm font-semibold capitalize">{value}</dd>
    </div>
  );
}

function Pager({ meta, onPage }: { meta?: PaginationMeta; onPage: (page: number) => void }) {
  if (!meta || meta.total <= meta.page_size) return null;
  const pages = Math.ceil(meta.total / meta.page_size);
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
      <Button
        size="sm"
        variant="secondary"
        disabled={meta.page <= 1}
        onClick={() => onPage(meta.page - 1)}
      >
        ← Prev
      </Button>
      <span className="text-sm text-muted">
        Page {meta.page} of {pages}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={meta.page >= pages}
        onClick={() => onPage(meta.page + 1)}
      >
        Next →
      </Button>
    </nav>
  );
}
