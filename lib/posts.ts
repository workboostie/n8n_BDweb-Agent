export type Post = {
  id: number;
  post_key: string;
  post_date: string;
  slot: string;
  bucket: string;
  planned_time: string;
  pillar: string;
  hook_style: string;
  caption: string;
  image_prompt: string;
  telegram_file_id: string | null;
  status: string;
  fb_post_id?: string | null;
};

export type Status = "draft" | "scheduled" | "published" | "rejected" | "expired";

export const TZ = "Asia/Dhaka";

export function dhakaDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtHHMM(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function fmtDay(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function dayLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return fmtDay(date);
}

export const STATUS_META: Record<Status, { label: string; badge: string; dot: string }> = {
  draft: { label: "Draft", badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-400" },
  scheduled: { label: "Scheduled", badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-400" },
  published: { label: "Published", badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300", dot: "bg-sky-400" },
  rejected: { label: "Skipped", badge: "bg-slate-500/15 text-slate-600 dark:text-slate-400", dot: "bg-slate-400" },
  expired: { label: "Time passed", badge: "bg-red-500/15 text-red-700 dark:text-red-300", dot: "bg-red-400" },
};

export const isTextOnly = (p: Post) => p.image_prompt === "TEXT_ONLY";
export const needsImage = (p: Post) => !isTextOnly(p) && !p.telegram_file_id;
export const formatName = (p: Post) => String(p.hook_style || "").split(":")[0].replace(/_/g, " ") || "post";
export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function liveStatus(p: Post, now = Date.now()): Status {
  if (p.status === "draft" && new Date(p.planned_time).getTime() < now) return "expired";
  return (p.status as Status) || "draft";
}

export function deadlineLabel(p: Post, today: string) {
  if (liveStatus(p) !== "draft") return null;
  if (p.post_date <= today) return { text: "Posts today", tone: "red" as const };
  if (p.post_date === addDays(today, 1)) return { text: "Review tonight", tone: "amber" as const };
  return { text: `Review by ${fmtDay(addDays(p.post_date, -1))}`, tone: "slate" as const };
}

export function summarize(posts: Post[], now = new Date()) {
  const today = dhakaDate(now);
  const tomorrow = addDays(today, 1);
  const live = posts.map((p) => ({ ...p, live: liveStatus(p, now.getTime()) }));
  const drafts = live.filter((p) => p.live === "draft");
  const tmr = live.filter((p) => p.post_date === tomorrow && p.live !== "rejected" && p.live !== "expired");
  const tmrReady = tmr.filter((p) => p.live === "scheduled" || p.live === "published").length;
  const dueTonight = drafts.filter((p) => p.post_date <= tomorrow).length;
  const upcoming = live.filter((p) => p.post_date >= today && p.live !== "rejected");
  const scheduled = upcoming.filter((p) => p.live === "scheduled").length;
  const expiredRecent = live.filter((p) => p.live === "expired" && p.post_date >= addDays(today, -7)).length;
  const last = drafts.map((p) => p.post_date).sort().pop();
  const daysLeft = last ? Math.max(1, daysBetween(today, last)) : 1;
  return {
    today,
    tomorrow,
    drafts: drafts.length,
    needImage: drafts.filter(needsImage).length,
    tomorrowTotal: tmr.length,
    tomorrowReady: tmrReady,
    dueTonight,
    scheduled,
    upcomingTotal: upcoming.length,
    expiredRecent,
    pace: drafts.length ? Math.ceil(drafts.length / daysLeft) : 0,
    lastDraftDate: last ?? null,
  };
}
