import Link from "next/link";
import { getPosts } from "@/lib/n8n";
import { STATUS_META, addDays, dhakaDate, fmtDay, fmtTime, formatName, liveStatus, needsImage } from "@/lib/posts";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const w = Number((await searchParams).w) || 0;
  const today = dhakaDate();
  const start = addDays(today, w * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const posts = (await getPosts())
    .filter((p) => p.post_date >= start && p.post_date <= days[6] && p.status !== "rejected")
    .sort((a, b) => String(a.planned_time).localeCompare(String(b.planned_time)));
  const counts = { draft: 0, scheduled: 0, published: 0 };
  for (const p of posts) {
    const s = liveStatus(p);
    if (s in counts) counts[s as keyof typeof counts]++;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Schedule</h1>
          <p className="mt-1 text-sm muted">
            {fmtDay(start)} – {fmtDay(days[6])} · {counts.scheduled + counts.published} scheduled · {counts.draft} drafts
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/schedule?w=${w - 1}`} className="btn btn-ghost px-2.5" aria-label="Previous week">
            <Icon name="back" className="size-4" />
          </Link>
          <Link href="/schedule" className="btn btn-ghost">
            This week
          </Link>
          <Link href={`/schedule?w=${w + 1}`} className="btn btn-ghost px-2.5" aria-label="Next week">
            <Icon name="next" className="size-4" />
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs muted">
        {(["draft", "scheduled", "published", "expired"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${STATUS_META[s].dot}`} /> {STATUS_META[s].label}
          </span>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => {
          const list = posts.filter((p) => p.post_date === d);
          return (
            <div key={d} className={`panel min-h-36 p-3 ${d === today ? "ring-2 ring-emerald-500/50" : ""}`}>
              <div className="flex items-baseline justify-between">
                <span className={`text-sm font-semibold ${d === today ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  {d === today ? "Today" : fmtDay(d)}
                </span>
                <span className="text-xs muted">{list.length || ""}</span>
              </div>
              <div className="mt-3 space-y-1.5">
                {list.length === 0 && <p className="text-xs muted">No posts</p>}
                {list.map((p) => {
                  const s = liveStatus(p);
                  const href = s === "draft" || s === "expired" ? `/?p=${p.post_key}` : "/published";
                  return (
                    <Link
                      key={p.post_key}
                      href={href}
                      className="block rounded-lg bg-slate-50 px-2.5 py-2 text-xs transition-colors hover:bg-slate-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.07]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`size-1.5 shrink-0 rounded-full ${STATUS_META[s].dot}`} />
                        <span className="font-semibold tabular-nums">{fmtTime(p.planned_time)}</span>
                        {s === "draft" && needsImage(p) && <Icon name="image" className="ml-auto size-3.5 text-amber-500" />}
                      </div>
                      <div className="mt-0.5 truncate capitalize muted">{formatName(p)}</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
