import { getPosts } from "@/lib/n8n";
import { dhakaDate } from "@/lib/posts";
import { ReviewClient } from "@/components/ReviewClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const today = dhakaDate();
  const drafts = (await getPosts())
    .filter((x) => x.status === "draft" && x.post_date >= today)
    .sort((a, b) => String(a.planned_time).localeCompare(String(b.planned_time)));
  return <ReviewClient posts={drafts} today={today} initialKey={p} />;
}
