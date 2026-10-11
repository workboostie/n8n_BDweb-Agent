import Link from "next/link";
import { getPosts } from "@/lib/n8n";
import { STATUS_META, addDays, dhakaDate, fmtDay, fmtTime, formatName, isTextOnly, liveStatus, type Status } from "@/lib/posts";
import { Icon } from "@/components/Icon";
import { RestoreButton } from "@/components/RestoreButton";

export const dynamic = "force-dynamic";

type Tab = "scheduled" | "published" | "skipped";
const TABS: { id: Tab; label: string }[] = [
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "skipped", label: "Skipped" },
];

function shownStatus(s: Status, planned: string): Status {
  return s === "scheduled" && Date.parse(planned) < Date.now() ? "published" : s;
}

export default async function PublishedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tabParam = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === tabParam) ? (tabParam as Tab) : "scheduled";
  const today = dhakaDate();
  const all = (await getPosts()).map((p) => ({ ...p, shown: shownStatus(liveStatus(p), p.planned_time) }));
  const byTab: Record<Tab, typeof all> = {
    scheduled: all.filter((p) => p.shown === "scheduled").sort((a, b) => a.planned_time.localeCompare(b.planned_time)),
    published: all.filter((p) => p.shown === "published").sort((a, b) => b.planned_time.localeCompare(a.planned_time)),
    skipped: all
      .filter((p) => (p.shown === "rejected" || p.shown === "expired") && p.post_date >= addDays(today, -14))
      .sort((a, b) => b.planned_time.localeCompare(a.planned_time)),
  };
  const list = byTab[tab];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Published</h1>
        <p className="mt-1 text-sm muted">Posts already sent to Facebook, plus the ones you skipped.</p>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1 sm:w-fit dark:bg-white/5">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/published?tab=${t.id}`}
            className={`flex-1 rounded-lg px-4 py-1.5 text-center text-sm font-medium ${
              tab === t.id ? "bg-white shadow-sm dark:bg-[#1a2740]" : "muted hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {t.label} <span className="text-xs muted">{byTab[t.id].length}</span>
          </Link>
        ))}
      </div>

      <div className="panel divide-y divide-slate-200 dark:divide-white/[0.07]">
        {list.length === 0 && <p className="p-10 text-center text-sm muted">Nothing here yet.</p>}
        {list.map((p) => (
          <div key={p.post_key} className="flex gap-4 p-4">
            {p.telegram_file_id ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/image/${encodeURIComponent(p.telegram_file_id)}`}
                alt=""
                className="size-16 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-white/5"
              />
            ) : (
              <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-slate-100 muted dark:bg-white/5">
                <Icon name={isTextOnly(p) ? "text" : "image"} className="size-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">
                  {fmtDay(p.post_date)} · {fmtTime(p.planned_time)}
                </span>
                <span className="capitalize muted">{formatName(p)}</span>
                <span className={`badge ${STATUS_META[p.shown].badge}`}>{STATUS_META[p.shown].label}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{p.caption}</p>
            </div>
            <div className="flex shrink-0 items-start">
              {p.fb_post_id ? (
                <a href={`https://www.facebook.com/${p.fb_post_id}`} target="_blank" rel="noreferrer" className="btn btn-quiet px-2.5" title="Open on Facebook">
                  <Icon name="external" className="size-4" />
                </a>
              ) : p.shown === "rejected" && p.post_date >= today ? (
                <RestoreButton postKey={p.post_key} />
              ) : p.shown === "expired" && p.post_date >= today ? (
                <Link href={`/?p=${p.post_key}`} className="btn btn-ghost px-2.5 py-1.5 text-xs">
                  New time
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
