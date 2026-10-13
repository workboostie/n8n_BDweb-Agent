import "server-only";
import { POSTS_TABLE, callDashboardApi, getConfig, getPosts, setConfig, updateRows } from "./n8n";
import { applyChanges, draftFilter, reschedule } from "./ops";
import { dhakaDate, fmtHHMM, formatName, isTextOnly, liveStatus, type Post } from "./posts";

export type ChatMsg = { from: "me" | "ai"; text: string };
export type PlannedTask = { tool: string; args: Record<string, unknown>; label: string };

const MAX_LOOKUP_ROUNDS = 3;
const MAX_TASKS = 40;
const ROUTER_MODELS = ["models/gemini-3.5-flash-lite", "models/gemini-3.5-flash-lite", "models/gemini-3.8-flash"];

const PROTECTED_KEYS = new Set(["dashboard_secret", "owner_chat_id", "page_id", "meta_app_id", "dashboard_url", "coach_last_reply", "style_version", "style_exemplars"]);

const LOOKUP_TOOLS = new Set(["list_posts", "get_post", "get_settings"]);
const TASK_TOOLS = new Set([
  "rewrite_post",
  "edit_post",
  "delete_post",
  "restore_post",
  "approve_post",
  "unschedule_post",
  "remove_image",
  "make_text_only",
  "new_image_prompt",
  "update_settings",
  "update_style_guide",
  "generate_drafts",
]);

const WORKERS = `WORKERS - each task you return is handed to a specialist and runs as its own job after you reply:
- rewrite_post {post_key, instruction, reference_keys?: ["post_key", ...]} -> the POST WRITER (a strong writing model that already knows the page voice, rules and style guide) rewrites the caption. instruction must be specific and self-contained: what to change, what to keep, and the owner's exact wording rules. reference_keys = posts whose style it should copy (tone, hook type, structure, length). Works on drafts and scheduled posts (scheduled ones are re-scheduled on Facebook automatically).
- edit_post {post_key, caption?, date?: "YYYY-MM-DD", time?: "HH:MM" (24h Dhaka)} -> exact change. Use caption only when the owner dictated the exact text. date and time go together; time must be 15+ minutes from now.
- delete_post {post_key} -> moves it to Skipped (restorable). Scheduled posts are taken off Facebook first.
- restore_post {post_key} -> brings a skipped post back to drafts.
- approve_post {post_key} -> schedules a draft on Facebook at its planned time.
- unschedule_post {post_key} -> takes a scheduled post off Facebook, back to drafts.
- make_text_only {post_key} -> turns a post into a text-only post (no image).
- new_image_prompt {post_key} -> writes a fresh image prompt (also turns a text-only post back into an image post).
- remove_image {post_key} -> deletes the uploaded image file only.
- update_settings {values: {key: "value"}} -> posts_per_week, posts_per_day, text_only_per_day, follow_cta_rate (0-1), extra_post_day (Mon..Sun), paused ("true"/"false"), voice, rules, audience, pillars, image_style, follow_cta, launch_landinglagbe.
- update_style_guide {instruction} -> the WRITING COACH updates the style guide every future post follows. Use for any lasting writing preference (hooks, tone, length, wording, endings). Never put dates, schedules or post counts in it.
- generate_drafts {} -> writes drafts for empty slots from tomorrow through the Friday after the coming Saturday. Runs in the background for several minutes. Only when days are genuinely short of posts.

LOOKUPS - instant; results come back to you before you answer:
- get_post {post_key} -> full caption and details.
- list_posts {from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", status?: "draft"|"scheduled"|"published"|"skipped"|"all"} -> post lines.
- get_settings {} -> all page settings.`;

function dhakaNow() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusOf(p: Post) {
  const s = liveStatus(p);
  return s === "rejected" ? "skipped" : s;
}

function line(p: Post) {
  const img = p.telegram_file_id ? "image" : isTextOnly(p) ? "text-only" : "no-image";
  const first = p.caption.replace(/\s+/g, " ").slice(0, 90);
  return `${p.post_key} | ${p.post_date} ${fmtHHMM(p.planned_time)} | ${statusOf(p)} | ${formatName(p)} | ${img} | ${first}`;
}

function sortPosts(posts: Post[]) {
  return [...posts].sort((a, b) => String(a.planned_time).localeCompare(String(b.planned_time)));
}

function str(v: unknown) {
  return v === undefined || v === null ? undefined : String(v);
}

async function findPost(key: unknown) {
  const k = String(key || "").replace(/^#/, "").trim();
  if (!k) throw new Error("post_key is required");
  const p = (await getPosts()).find((x) => x.post_key === k);
  if (!p) throw new Error(`Post ${k} not found`);
  return p;
}

async function withDraft(p: Post, fn: () => Promise<unknown>) {
  if (p.status === "scheduled") return reschedule(p.post_key, fn);
  if (p.status !== "draft") throw new Error(`${p.post_key} is ${statusOf(p)} and cannot be changed`);
  return fn();
}

async function runTool(tool: string, args: Record<string, unknown>): Promise<string> {
  switch (tool) {
    case "list_posts": {
      const today = dhakaDate();
      const from = str(args.from) || today;
      const to = str(args.to) || "9999-12-31";
      const status = str(args.status) || "active";
      const rows = sortPosts(await getPosts()).filter((p) => {
        if (p.post_date < from || p.post_date > to) return false;
        const s = statusOf(p);
        if (status === "all") return true;
        if (status === "active") return s === "draft" || s === "scheduled" || s === "expired";
        return s === status;
      });
      return rows.length ? `${rows.length} posts:\n${rows.map(line).join("\n")}` : "No posts match.";
    }
    case "get_post": {
      const p = await findPost(args.post_key);
      return JSON.stringify({
        post_key: p.post_key,
        date: p.post_date,
        time: fmtHHMM(p.planned_time),
        status: statusOf(p),
        format: formatName(p),
        pillar: p.pillar,
        has_image: !!p.telegram_file_id,
        image_prompt: p.image_prompt,
        caption: p.caption,
      });
    }
    case "get_settings": {
      const cfg = await getConfig();
      return Object.entries(cfg)
        .filter(([k]) => !PROTECTED_KEYS.has(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    }
    case "edit_post": {
      const p = await findPost(args.post_key);
      const changes = {
        ...(args.caption !== undefined ? { caption: String(args.caption) } : {}),
        ...(args.date || args.time
          ? { date: str(args.date) || p.post_date, time: str(args.time) || fmtHHMM(p.planned_time) }
          : {}),
      };
      if (!Object.keys(changes).length) throw new Error("Nothing to change");
      await withDraft(p, () => applyChanges(p.post_key, changes));
      return `Updated ${p.post_key}${p.status === "scheduled" ? " and re-scheduled it on Facebook" : ""}`;
    }
    case "rewrite_post": {
      const p = await findPost(args.post_key);
      let feedback = String(args.instruction || "").trim() || "Stronger hook, more practical and specific";
      const refs = (Array.isArray(args.reference_keys) ? args.reference_keys : []).map(String).filter((k) => k !== p.post_key).slice(0, 3);
      if (refs.length) {
        const all = await getPosts();
        const texts = refs
          .map((k) => all.find((x) => x.post_key === k.replace(/^#/, "").trim()))
          .filter((x): x is Post => !!x && !!x.caption)
          .map((x) => `--- ${x.post_key} ---\n${x.caption.slice(0, 1500)}`);
        if (texts.length) {
          feedback += `\n\nMATCH THE STYLE of these reference posts (tone, hook type, structure, paragraph rhythm, length). Do not copy their topic, examples or sentences:\n${texts.join("\n\n")}`;
        }
      }
      await withDraft(p, () => callDashboardApi("rewrite", { post_key: p.post_key, feedback }));
      const after = await findPost(p.post_key);
      return `Rewrote ${p.post_key}${p.status === "scheduled" ? " (re-scheduled)" : ""}. Now starts: ${after.caption.replace(/\s+/g, " ").slice(0, 120)}`;
    }
    case "delete_post": {
      const p = await findPost(args.post_key);
      if (p.status === "published") throw new Error(`${p.post_key} is already published on Facebook and cannot be deleted from here`);
      if (p.status === "rejected") return `${p.post_key} was already deleted`;
      if (p.status === "scheduled") await callDashboardApi("unschedule", { post_key: p.post_key });
      await updateRows(POSTS_TABLE, draftFilter(p.post_key), { status: "rejected" });
      return `Deleted ${p.post_key}${p.status === "scheduled" ? " (removed from the Facebook schedule)" : ""}`;
    }
    case "restore_post": {
      const p = await findPost(args.post_key);
      if (p.status !== "rejected") return `${p.post_key} is already ${statusOf(p)}`;
      await updateRows(POSTS_TABLE, [{ columnName: "post_key", condition: "eq", value: p.post_key }], { status: "draft" });
      return `Restored ${p.post_key} to drafts`;
    }
    case "approve_post": {
      const p = await findPost(args.post_key);
      if (p.status === "scheduled") return `${p.post_key} is already scheduled`;
      if (p.status !== "draft") throw new Error(`${p.post_key} is ${statusOf(p)}`);
      await callDashboardApi("approve", { post_key: p.post_key });
      return `Scheduled ${p.post_key} on Facebook`;
    }
    case "unschedule_post": {
      const p = await findPost(args.post_key);
      if (p.status === "draft") return `${p.post_key} is already a draft`;
      await callDashboardApi("unschedule", { post_key: p.post_key });
      return `Unscheduled ${p.post_key}; it is back in drafts`;
    }
    case "remove_image": {
      const p = await findPost(args.post_key);
      await withDraft(p, () => updateRows(POSTS_TABLE, draftFilter(p.post_key), { telegram_file_id: "" }));
      return `Removed the image from ${p.post_key}`;
    }
    case "make_text_only": {
      const p = await findPost(args.post_key);
      await withDraft(p, () => updateRows(POSTS_TABLE, draftFilter(p.post_key), { image_prompt: "TEXT_ONLY", telegram_file_id: "" }));
      return `Made ${p.post_key} a text-only post`;
    }
    case "new_image_prompt": {
      const p = await findPost(args.post_key);
      await withDraft(p, () => callDashboardApi("new_image_prompt", { post_key: p.post_key }));
      return `Wrote a new image prompt for ${p.post_key}`;
    }
    case "update_settings": {
      const values = (args.values && typeof args.values === "object" ? args.values : args) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (PROTECTED_KEYS.has(k) || k === "style_guide") throw new Error(`${k} cannot be changed this way`);
        if (!/^[a-z][a-z0-9_]{1,40}$/.test(k)) throw new Error(`Invalid setting name ${k}`);
        clean[k] = String(v);
      }
      if (!Object.keys(clean).length) throw new Error("No settings given");
      await setConfig(clean);
      return `Updated settings: ${Object.entries(clean).map(([k, v]) => `${k} = ${v.slice(0, 40)}`).join(", ")}`;
    }
    case "update_style_guide": {
      const r = await callDashboardApi<{ reply?: string }>("coach", { mode: "chat", text: String(args.instruction || "") });
      return `Style guide: ${r.reply || "updated"}`;
    }
    case "generate_drafts": {
      const r = await callDashboardApi<{ msg?: string }>("generate_now");
      return r.msg || "Draft generation started";
    }
    default:
      throw new Error(`Unknown tool ${tool}`);
  }
}

export function describe(tool: string, args: Record<string, unknown>) {
  const k = args.post_key ? ` ${String(args.post_key)}` : "";
  switch (tool) {
    case "rewrite_post":
      return `Rewrite post${k}`;
    case "edit_post":
      return args.caption !== undefined ? `Edit the caption of post${k}` : `Move post${k} to ${str(args.date) || ""} ${str(args.time) || ""}`.trim();
    case "delete_post":
      return `Delete post${k}`;
    case "restore_post":
      return `Restore post${k}`;
    case "approve_post":
      return `Schedule post${k} on Facebook`;
    case "unschedule_post":
      return `Take post${k} off Facebook`;
    case "remove_image":
      return `Remove the image from post${k}`;
    case "make_text_only":
      return `Make post${k} text-only`;
    case "new_image_prompt":
      return `New image prompt for post${k}`;
    case "update_settings":
      return `Update settings (${Object.keys((args.values as object) || args).join(", ")})`;
    case "update_style_guide":
      return "Update the style guide";
    case "generate_drafts":
      return "Generate missing drafts";
    default:
      return tool;
  }
}

type RouterOut = {
  lookups?: { tool: string; args?: Record<string, unknown> }[];
  tasks?: { tool: string; args?: Record<string, unknown> }[];
  reply?: string;
};

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function decodeEscapes(s: string) {
  return (
    tryParse<string>(`"${s.replace(/\r?\n/g, "\\n")}"`) ??
    s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, "\n").replace(/\\"/g, '"')
  );
}

function parseJson(text: string): RouterOut {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return { reply: t };
  const body = t.slice(start, end + 1);
  const out = tryParse<RouterOut>(body) ?? tryParse<RouterOut>(body.replace(/[\r\n\t]+/g, " "));
  if (out) return out;
  const m = body.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  return { reply: m ? decodeEscapes(m[1]) : decodeEscapes(t) };
}

async function askRouter(prompt: string) {
  let last: unknown;
  for (let i = 0; i < ROUTER_MODELS.length; i++) {
    try {
      return await callDashboardApi<{ text?: string }>("llm", { text: prompt, model: ROUTER_MODELS[i] });
    } catch (e) {
      last = e;
      if (i < ROUTER_MODELS.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new Error(/unavailable|overload|503|429|quota|too many/i.test(msg) ? "Google's AI service is overloaded right now. Wait a minute and send your message again." : msg);
}

function buildRouterPrompt(o: {
  owner: string;
  pageName: string;
  history: ChatMsg[];
  overview: string;
  running: string[];
  lookups: string[];
}) {
  const today = dhakaDate();
  const convo = o.history.map((m) => `${m.from === "me" ? o.owner.toUpperCase() : "ASSISTANT"}: ${m.text.slice(0, 1500)}`).join("\n");
  return `You are the front-desk assistant for ${o.owner}'s Facebook page "${o.pageName}". You reply fast, understand what ${o.owner} wants, split it into concrete tasks and hand each task to the right specialist worker with clear instructions. You never write posts yourself.

NOW (Asia/Dhaka): ${dhakaNow()}. Today = ${today}. Yesterday = ${shiftDate(today, -1)}. Tomorrow = ${shiftDate(today, 1)}.
Times of day: morning = before 12:00, noon/lunch = 12:00-14:59, afternoon = 15:00-17:59, evening/night = 18:00 and later.

${WORKERS}

STATUSES: draft = waiting for ${o.owner}'s review, not on Facebook. scheduled = approved and queued on Facebook. expired = draft whose time passed. published = live (never touch). skipped = deleted.

HOW TO DECIDE:
1. The LAST message from ${o.owner} is the request; earlier messages are context. If the last message only checks on you ("are you there?", "can you read my messages?"), answer it and look back for an earlier request that was never completed (an ASSISTANT error or "took too long" right after it). If one exists, do it now.
2. Resolve every reference ("today's posts", "the morning post", "yesterday's style", "these") to exact post_keys from POSTS. Never invent post_keys. Never return tasks for published or skipped posts unless asked to restore.
3. Categorize and route:
   - question or chat -> answer in reply, no tasks.
   - fix / rewrite / improve specific posts -> one rewrite_post per post, each with a specific instruction.
   - "I said not to ...", "don't use this kind of ..." -> rewrite the affected upcoming posts AND add the rule with update_style_guide so future posts follow it.
   - "in X's style" -> rewrite_post with reference_keys pointing at those posts.
   - times, dates, deleting, approving, unscheduling -> edit_post / delete_post / approve_post / unschedule_post.
   - posting volume, quotas, voice, rules -> update_settings. Writing preferences -> update_style_guide.
4. Use lookups only when the first words in POSTS are not enough to decide (for example to read a full caption).
5. If the request is genuinely unclear or risky, ask one short question and return no tasks.

REPLY: 1-3 short sentences in plain text. Reply in English unless ${o.owner} writes in Bangla script. Say what you understood and what the workers are about to do (they start right after your reply), e.g. "Got it - rewriting today's 4 drafts without time-of-day openers and adding that rule to the style guide." Never claim work is finished.

TASKS STILL RUNNING FROM EARLIER MESSAGES (do not queue them again):
${o.running.length ? o.running.map((r) => `- ${r}`).join("\n") : "(none)"}

POSTS (key | date time | status | format | image | first words):
${o.overview}

CONVERSATION:
${convo}
${o.lookups.length ? `\nLOOKUP RESULTS:\n${o.lookups.join("\n\n")}\n` : ""}
Return ONLY this JSON: {"lookups":[{"tool":"get_post","args":{"post_key":"..."}}],"reply":"","tasks":[{"tool":"rewrite_post","args":{}}]}
- If you need lookups, list them and leave reply and tasks empty; you will be called again with the results.
- Otherwise return "lookups": [] with your reply and the tasks (up to ${MAX_TASKS}).`;
}

export async function planTurn(history: ChatMsg[], running: string[] = []): Promise<{ reply: string; tasks: PlannedTask[] }> {
  const [cfg, posts] = await Promise.all([getConfig(), getPosts()]);
  const owner = cfg.owner_name || "the owner";
  const from = shiftDate(dhakaDate(), -3);
  const overview = sortPosts(posts).filter((p) => p.post_date >= from && p.status !== "rejected").map(line).join("\n") || "(none)";
  const lookups: string[] = [];

  for (let round = 0; round <= MAX_LOOKUP_ROUNDS; round++) {
    const r = await askRouter(buildRouterPrompt({ owner, pageName: cfg.page_name || "", history, overview, running, lookups }));
    const out = parseJson(String(r.text || ""));
    const wanted = (Array.isArray(out.lookups) ? out.lookups : []).filter((l) => LOOKUP_TOOLS.has(l.tool)).slice(0, 10);
    if (wanted.length && round < MAX_LOOKUP_ROUNDS) {
      for (const l of wanted) {
        const args = l.args && typeof l.args === "object" ? l.args : {};
        try {
          lookups.push(`${l.tool} ${JSON.stringify(args)}:\n${(await runTool(l.tool, args)).slice(0, 4000)}`);
        } catch (e) {
          lookups.push(`${l.tool} ${JSON.stringify(args)} FAILED: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      continue;
    }
    const tasks = (Array.isArray(out.tasks) ? out.tasks : [])
      .filter((t) => t && TASK_TOOLS.has(t.tool))
      .slice(0, MAX_TASKS)
      .map((t) => {
        const args = t.args && typeof t.args === "object" ? t.args : {};
        return { tool: t.tool, args, label: describe(t.tool, args) };
      });
    return { reply: String(out.reply || (tasks.length ? "On it." : "Sorry, I didn't catch that. Could you say it another way?")).trim(), tasks };
  }
  return { reply: "I couldn't work out what to do. Could you say it another way?", tasks: [] };
}

export async function runTask(tool: string, args: Record<string, unknown>) {
  if (!TASK_TOOLS.has(tool)) throw new Error(`Unknown task ${tool}`);
  return runTool(tool, args);
}
