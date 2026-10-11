"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { POSTS_TABLE, callDashboardApi, setConfig, updateRows, type RowFilter } from "@/lib/n8n";
import { SESSION_COOKIE } from "@/lib/session";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type PostChanges = { caption?: string; date?: string; time?: string };

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: message || undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const draftFilter = (key: string): RowFilter[] => [
  { columnName: "post_key", condition: "eq", value: key },
  { columnName: "status", condition: "eq", value: "draft" },
];

async function applyChanges(key: string, c: PostChanges) {
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

export async function saveDraft(key: string, changes: PostChanges) {
  return run(async () => {
    await applyChanges(key, changes);
    return "Saved";
  });
}

export async function approvePost(key: string, changes: PostChanges = {}) {
  return run(async () => {
    await applyChanges(key, changes);
    await callDashboardApi("approve", { post_key: key });
    return "Scheduled on Facebook";
  });
}

export async function rewritePost(key: string, feedback: string, changes: PostChanges = {}) {
  return run(async () => {
    await applyChanges(key, changes);
    await callDashboardApi("rewrite", { post_key: key, feedback });
    return "Rewritten";
  });
}

export async function newImagePrompt(key: string) {
  return run(async () => {
    await callDashboardApi("new_image_prompt", { post_key: key });
    return "New image prompt ready";
  });
}

export async function skipPost(key: string) {
  return run(async () => {
    await updateRows(POSTS_TABLE, draftFilter(key), { status: "rejected" });
  });
}

export async function restorePost(key: string) {
  return run(async () => {
    await updateRows(POSTS_TABLE, [{ columnName: "post_key", condition: "eq", value: key }], { status: "draft" });
  });
}

export async function generateNow() {
  return run(async () => {
    const r = await callDashboardApi<{ msg?: string }>("generate_now");
    return r.msg;
  });
}

export async function askWriter(text: string) {
  return run(async () => {
    if (!text.trim()) throw new Error("Write a message first");
    const r = await callDashboardApi<{ reply?: string }>("coach", { mode: "chat", text: text.trim() });
    return r.reply || "Done.";
  });
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function saveSettings(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const perWeek = Number(form.get("posts_per_week"));
    const rate = Number(form.get("follow_cta_rate")) / 100;
    const textPerDay = Number(form.get("text_only_per_day"));
    const extraDay = String(form.get("extra_post_day"));
    if (!Number.isInteger(perWeek) || perWeek < 7 || perWeek > 100) throw new Error("Posts per week must be 7-100");
    if (!(rate >= 0 && rate <= 1)) throw new Error("Follow line rate must be 0-100%");
    if (!Number.isInteger(textPerDay) || textPerDay < 0 || textPerDay > 5) throw new Error("Text-only posts per day must be 0-5");
    if (!DAYS.includes(extraDay)) throw new Error("Pick a day for extra posts");
    await setConfig({
      posts_per_week: String(perWeek),
      follow_cta_rate: String(rate),
      text_only_per_day: String(textPerDay),
      extra_post_day: extraDay,
      paused: form.get("paused") === "on" ? "true" : "false",
    });
    return "Settings saved";
  });
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
