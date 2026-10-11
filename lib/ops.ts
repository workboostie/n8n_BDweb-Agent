import "server-only";
import { POSTS_TABLE, callDashboardApi, updateRows, type RowFilter } from "./n8n";

export type PostChanges = { caption?: string; date?: string; time?: string };

export const draftFilter = (key: string): RowFilter[] => [
  { columnName: "post_key", condition: "eq", value: key },
  { columnName: "status", condition: "eq", value: "draft" },
];

export async function applyChanges(key: string, c: PostChanges) {
  const data: Record<string, unknown> = {};
  if (c.caption !== undefined) {
    if (!c.caption.trim()) throw new Error("Caption cannot be empty");
    data.caption = c.caption.trim();
  }
  if (c.date !== undefined || c.time !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || "") || !/^\d{2}:\d{2}$/.test(c.time || "")) throw new Error("Pick a valid date and time");
    const iso = `${c.date}T${c.time}:00.000+06:00`;
    if (Date.parse(iso) < Date.now() + 15 * 60_000) throw new Error("Pick a time at least 15 minutes from now");
    Object.assign(data, { planned_time: iso, post_date: c.date, bucket: "manual" });
  }
  if (Object.keys(data).length) await updateRows(POSTS_TABLE, draftFilter(key), data);
}

export async function reschedule(key: string, edit: () => Promise<unknown>) {
  await callDashboardApi("unschedule", { post_key: key });
  try {
    await edit();
    await callDashboardApi("approve", { post_key: key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Removed from the Facebook schedule, but re-scheduling failed: ${msg}. The post is back in drafts.`);
  }
}
