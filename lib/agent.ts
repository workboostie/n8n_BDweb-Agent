import "server-only";
import { POSTS_TABLE, callDashboardApi, getConfig, getPosts, setConfig, updateRows } from "./n8n";
import { applyChanges, draftFilter, reschedule } from "./ops";
import { dhakaDate, fmtHHMM, formatName, isTextOnly, liveStatus, type Post } from "./posts";

export type ChatMsg = { from: "me" | "ai"; text: string };
export type AgentStep = { tool: string; args: Record<string, unknown>; ok: boolean; result: string };

const MAX_ROUNDS = 6;
const MAX_ACTIONS_PER_ROUND = 60;

const PROTECTED_KEYS = new Set(["dashboard_secret", "owner_chat_id", "page_id", "meta_app_id", "dashboard_url", "coach_last_reply", "style_version", "style_exemplars"]);

const TOOLS = `TOOLS (use the exact names and argument names):
- list_posts {from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", status?: "draft"|"scheduled"|"published"|"skipped"|"active"|"all"} -> one line per post. Default: from today, status "active" (drafts + scheduled).
- get_post {post_key} -> the full post including the whole caption and image prompt.
- edit_post {post_key, caption?, date?: "YYYY-MM-DD", time?: "HH:MM" (24h, Dhaka time)} -> replace the caption and/or move the post. date and time must be sent together. Works on drafts and scheduled posts (scheduled posts are re-scheduled on Facebook automatically). Time must be at least 15 minutes from now.
- rewrite_post {post_key, instruction} -> the writer AI rewrites the caption following the instruction. Drafts only.
- delete_post {post_key} -> removes the post (scheduled posts are taken off Facebook first). It moves to the Skipped list and can be restored. Published posts cannot be deleted.
- restore_post {post_key} -> brings a deleted/skipped post back to drafts.
- approve_post {post_key} -> schedule a draft on Facebook at its planned time.
- unschedule_post {post_key} -> take a scheduled post off Facebook and back to drafts.
- remove_image {post_key} -> remove the image so it posts as text only.
- new_image_prompt {post_key} -> write a fresh image prompt. Drafts only.
- get_settings {} -> all page settings.
- update_settings {values: {key: "value", ...}} -> change page settings (posts_per_week, posts_per_day, text_only_per_day, follow_cta_rate (0-1), extra_post_day (Mon..Sun), paused ("true"/"false"), voice, rules, audience, pillars, image_style, hook_styles, follow_cta, style_guide, learn_batch_size, launch_landinglagbe, ...).
- update_style_guide {instruction} -> the writing coach rewrites the style guide that every new draft follows.
- generate_drafts {} -> write drafts for any empty slots from tomorrow to the end of next week.`;

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

function statusOf(p: Post) {
  const s = liveStatus(p);
  return s === "rejected" ? "skipped" : s;
}

function line(p: Post) {
  const img = p.telegram_file_id ? "image" : isTextOnly(p) ? "text-only" : "no-image";
  const first = p.caption.replace(/\s+/g, " ").slice(0, 70);
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
    case "edit_post": {
      const p = await findPost(args.post_key);
      const changes = {
        ...(args.caption !== undefined ? { caption: String(args.caption) } : {}),
        ...(args.date || args.time
          ? { date: str(args.date) || p.post_date, time: str(args.time) || fmtHHMM(p.planned_time) }
          : {}),
      };
      if (!Object.keys(changes).length) throw new Error("Nothing to change");
      if (p.status === "scheduled") {
        await reschedule(p.post_key, () => applyChanges(p.post_key, changes));
        return `Updated ${p.post_key} and re-scheduled it on Facebook`;
      }
      if (p.status !== "draft") throw new Error(`${p.post_key} is ${statusOf(p)} and cannot be edited`);
      await applyChanges(p.post_key, changes);
      return `Updated ${p.post_key}`;
    }
    case "rewrite_post": {
      const p = await findPost(args.post_key);
      if (p.status !== "draft") throw new Error(`${p.post_key} is ${statusOf(p)}. Unschedule it first to rewrite with AI.`);
      await callDashboardApi("rewrite", { post_key: p.post_key, feedback: String(args.instruction || "") });
      const after = await findPost(p.post_key);
      return `Rewrote ${p.post_key}. New caption starts: ${after.caption.slice(0, 160)}`;
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
      if (p.status !== "rejected") throw new Error(`${p.post_key} is ${statusOf(p)}, not deleted`);
      await updateRows(POSTS_TABLE, [{ columnName: "post_key", condition: "eq", value: p.post_key }], { status: "draft" });
      return `Restored ${p.post_key} to drafts`;
    }
    case "approve_post": {
      const p = await findPost(args.post_key);
      if (p.status !== "draft") throw new Error(`${p.post_key} is ${statusOf(p)}`);
      await callDashboardApi("approve", { post_key: p.post_key });
      return `Scheduled ${p.post_key} on Facebook`;
    }
    case "unschedule_post": {
      const p = await findPost(args.post_key);
      await callDashboardApi("unschedule", { post_key: p.post_key });
      return `Unscheduled ${p.post_key}; it is back in drafts`;
    }
    case "remove_image": {
      const p = await findPost(args.post_key);
      const clear = () => updateRows(POSTS_TABLE, draftFilter(p.post_key), { telegram_file_id: "" });
      if (p.status === "scheduled") await reschedule(p.post_key, clear);
      else if (p.status === "draft") await clear();
      else throw new Error(`${p.post_key} is ${statusOf(p)}`);
      return `Removed the image from ${p.post_key}`;
    }
    case "new_image_prompt": {
      const p = await findPost(args.post_key);
      if (p.status !== "draft") throw new Error(`${p.post_key} is ${statusOf(p)}. Unschedule it first.`);
      await callDashboardApi("new_image_prompt", { post_key: p.post_key });
      return `Wrote a new image prompt for ${p.post_key}`;
    }
    case "get_settings": {
      const cfg = await getConfig();
      return Object.entries(cfg)
        .filter(([k]) => !PROTECTED_KEYS.has(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    }
    case "update_settings": {
      const values = (args.values && typeof args.values === "object" ? args.values : args) as Record<string, unknown>;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (PROTECTED_KEYS.has(k)) throw new Error(`${k} cannot be changed from the chat`);
        if (!/^[a-z][a-z0-9_]{1,40}$/.test(k)) throw new Error(`Invalid setting name ${k}`);
        clean[k] = String(v);
      }
      if (!Object.keys(clean).length) throw new Error("No settings given");
      await setConfig(clean);
      return `Updated settings: ${Object.keys(clean).join(", ")}`;
    }
    case "update_style_guide": {
      const r = await callDashboardApi<{ reply?: string }>("coach", { mode: "chat", text: String(args.instruction || "") });
      return `Style guide coach replied: ${r.reply || "done"}`;
    }
    case "generate_drafts": {
      const r = await callDashboardApi<{ msg?: string }>("generate_now");
      return r.msg || "Draft generation started";
    }
    default:
      throw new Error(`Unknown tool ${tool}`);
  }
}

function parseJson(text: string): { actions?: { tool: string; args?: Record<string, unknown> }[]; reply?: string } {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return { reply: t };
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return { reply: t };
  }
}

function buildPrompt(owner: string, pageName: string, history: ChatMsg[], overview: string, steps: AgentStep[], round: number) {
  const convo = history.map((m) => `${m.from === "me" ? owner.toUpperCase() : "YOU"}: ${m.text.slice(0, 2000)}`).join("\n");
  const done = steps.length
    ? steps.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args)} -> ${s.ok ? "OK" : "FAILED"}: ${s.result.slice(0, 1500)}`).join("\n")
    : "(nothing yet)";
  return `You are ${owner}'s personal assistant and operator for the Facebook page "${pageName}". You have FULL ACCESS to the page's posts and settings through the tools below and you must actually carry out what ${owner} asks by calling tools - never claim something is done unless a tool result confirms it.

NOW (Asia/Dhaka): ${dhakaNow()}. Today is ${dhakaDate()}.

${TOOLS}

HOW TO WORK:
- Plan, then act. Return as many actions per round as needed (up to ${MAX_ACTIONS_PER_ROUND}); they run in order. After they run you get the results and can continue.
- Use the post list below to pick post_keys. Call get_post before editing a caption so you keep everything you are not asked to change.
- Changing how many posts go out on certain days means deleting or adding drafts on those days, not just editing settings. To reduce, delete the weakest or most repetitive drafts and keep a good spread through the day. Also update posts_per_week / posts_per_day settings if the change is meant to last.
- Writing preferences (tone, hooks, length, wording) go to update_style_guide. Edits to specific posts go to edit_post or rewrite_post.
- If the request is unclear or would delete published content, ask instead of acting.
- When everything is done (or you only need to answer), return no actions and a reply: warm, first person, simple English, short. Say exactly what you changed (post keys, dates) and anything that failed.

UPCOMING POSTS (drafts + scheduled, key | date time | status | format | image | first words):
${overview}

CONVERSATION:
${convo}

ACTIONS ALREADY DONE THIS TURN (round ${round}/${MAX_ROUNDS}):
${done}

Reply with ONLY this JSON: {"actions":[{"tool":"name","args":{}}],"reply":""}
- Put tool calls in "actions" and leave "reply" empty while you still have work to do.
- When finished, return "actions": [] and your final message in "reply".`;
}

export async function runAgent(history: ChatMsg[]): Promise<{ reply: string; steps: AgentStep[] }> {
  const [cfg, posts] = await Promise.all([getConfig(), getPosts()]);
  const owner = cfg.owner_name || "the owner";
  const today = dhakaDate();
  const upcoming = sortPosts(posts).filter((p) => p.post_date >= today && (p.status === "draft" || p.status === "scheduled"));
  let overview = upcoming.map(line).join("\n") || "(none)";
  const steps: AgentStep[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const r = await callDashboardApi<{ text?: string }>("llm", { text: buildPrompt(owner, cfg.page_name || "", history, overview, steps, round) });
    const out = parseJson(String(r.text || ""));
    const actions = Array.isArray(out.actions) ? out.actions.slice(0, MAX_ACTIONS_PER_ROUND) : [];
    if (!actions.length) return { reply: String(out.reply || "Done.").trim(), steps };
    for (const a of actions) {
      const args = a.args && typeof a.args === "object" ? a.args : {};
      try {
        steps.push({ tool: a.tool, args, ok: true, result: await runTool(a.tool, args) });
      } catch (e) {
        steps.push({ tool: a.tool, args, ok: false, result: e instanceof Error ? e.message : String(e) });
      }
    }
    if (actions.some((a) => a.tool !== "list_posts" && a.tool !== "get_post" && a.tool !== "get_settings")) {
      const fresh = sortPosts(await getPosts()).filter((p) => p.post_date >= today && (p.status === "draft" || p.status === "scheduled"));
      overview = fresh.map(line).join("\n") || "(none)";
    }
  }
  const failed = steps.filter((s) => !s.ok).length;
  return {
    reply: `I ran ${steps.length} actions${failed ? ` (${failed} failed)` : ""} but ran out of steps before finishing. Tell me to continue if there is more to do.`,
    steps,
  };
}
