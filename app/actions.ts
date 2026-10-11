"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { POSTS_TABLE, callDashboardApi, setConfig, updateRows } from "@/lib/n8n";
import { applyChanges, draftFilter, reschedule, type PostChanges } from "@/lib/ops";
import { SESSION_COOKIE } from "@/lib/session";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
export type { PostChanges };

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message: message || undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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

export async function updateScheduledPost(key: string, changes: PostChanges) {
  return run(async () => {
    await reschedule(key, () => applyChanges(key, changes));
    return "Updated on Facebook";
  });
}

export async function unschedulePost(key: string) {
  return run(async () => {
    await callDashboardApi("unschedule", { post_key: key });
    return "Removed from the Facebook schedule. It's back in drafts.";
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

export async function removeImage(key: string, scheduled = false) {
  return run(async () => {
    const clear = () => updateRows(POSTS_TABLE, draftFilter(key), { telegram_file_id: "" });
    if (scheduled) {
      await reschedule(key, clear);
      return "Image removed. Facebook post updated to text only.";
    }
    await clear();
    return "Image removed. This will post as text only.";
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
