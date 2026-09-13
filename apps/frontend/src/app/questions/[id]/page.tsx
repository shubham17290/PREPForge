import { QuestionDetailPage } from "@/features/practice/question-detail";
import { RequireAuth } from "@/components/layout/guards";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RequireAuth>
      <QuestionDetailPage questionId={id} />
    </RequireAuth>
  );
}