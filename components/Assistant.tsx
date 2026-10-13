"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

type Step = { ok: boolean; text: string; tool?: string };
type Msg = { from: "me" | "ai"; text: string; error?: boolean; steps?: Step[]; summary?: string };
type TaskState = "todo" | "running" | "done" | "failed" | "stopped";
type Task = { tool: string; args: Record<string, unknown>; label: string; state: TaskState; result?: string };
type Job = { tasks: Task[]; started: number };

const STORE_KEY = "writerChat";
const JOB_KEY = "writerJob";
const IDLE_MS = 6 * 60 * 60 * 1000;
const WORKERS = 2;

const SUGGESTIONS = [
  "Rewrite today's drafts with stronger hooks",
  "Delete the weakest drafts so each day from tomorrow has 5 posts",
  "What's scheduled for tomorrow?",
];

const COUNTED: Record<string, string> = {
  delete_post: "Deleted",
  edit_post: "Edited",
  rewrite_post: "Rewrote",
  restore_post: "Restored",
  approve_post: "Scheduled",
  unschedule_post: "Unscheduled",
  remove_image: "Removed the image from",
  make_text_only: "Made # text-only",
  new_image_prompt: "New image prompt for",
};
const ONCE: Record<string, string> = {
  update_settings: "updated settings",
  update_style_guide: "updated the style guide",
  generate_drafts: "started writing new drafts",
};

function duration(secs: number) {
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function summarize(tasks: Task[], secs: number) {
  const counts = new Map<string, number>();
  for (const t of tasks) if (t.state === "done") counts.set(t.tool, (counts.get(t.tool) || 0) + 1);
  const parts: string[] = [];
  for (const [tool, n] of counts) {
    const posts = `${n} post${n === 1 ? "" : "s"}`;
    if (COUNTED[tool]) parts.push(COUNTED[tool].includes("#") ? COUNTED[tool].replace("#", posts) : `${COUNTED[tool]} ${posts}`);
    else if (ONCE[tool]) parts.push(ONCE[tool]);
  }
  const failed = tasks.filter((t) => t.state === "failed").length;
  const stopped = tasks.filter((t) => t.state === "stopped").length;
  if (failed) parts.push(`${failed} failed`);
  if (stopped) parts.push(`${stopped} stopped`);
  const what = parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "No changes made";
  return `Done in ${duration(secs)} · ${what}`;
}

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") as T | null;
  } catch {
    return null;
  }
}

function loadChat(): Msg[] {
  const raw = load<{ msgs?: Msg[]; last?: number }>(STORE_KEY);
  if (!raw?.msgs || !raw.last || Date.now() - raw.last > IDLE_MS) {
    localStorage.removeItem(STORE_KEY);
    return [];
  }
  return raw.msgs;
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-1.5 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function Spinner({ className = "size-4" }: { className?: string }) {
  return <span className={`${className} shrink-0 animate-spin rounded-full border-2 border-emerald-500/25 border-t-emerald-500`} />;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{duration(Math.max(0, Math.floor((now - since) / 1000)))}</span>;
}

export function Assistant({ version, pending, need }: { version: number; pending: number; need: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const jobRef = useRef<Job | null>(null);
  const loopRef = useRef(false);
  const stopRef = useRef(false);

  const working = !!job && job.tasks.some((t) => t.state === "todo" || t.state === "running");

  function putJob(next: Job | null) {
    jobRef.current = next;
    setJob(next);
    try {
      if (next) localStorage.setItem(JOB_KEY, JSON.stringify(next));
      else localStorage.removeItem(JOB_KEY);
    } catch {}
  }

  function patchTask(i: number, p: Partial<Task>) {
    const j = jobRef.current;
    if (!j) return;
    putJob({ ...j, tasks: j.tasks.map((t, k) => (k === i ? { ...t, ...p } : t)) });
  }

  async function execute(t: Task): Promise<{ ok: boolean; text: string }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/assistant/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: t.tool, args: t.args }),
          signal: AbortSignal.timeout(295_000),
        });
        if (res.status === 401) return { ok: false, text: "Your login expired. Reload the page and log in again." };
        const j = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string; retryable?: boolean } | null;
        if (j?.ok) return { ok: true, text: j.text || "Done" };
        if (j?.retryable && attempt === 0) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        return { ok: false, text: j?.error || `Request failed (${res.status})` };
      } catch (e) {
        if (attempt === 0) continue;
        return { ok: false, text: e instanceof Error && e.name === "TimeoutError" ? "Took too long - check this post" : "Connection problem" };
      }
    }
    return { ok: false, text: "Failed" };
  }

  function finish() {
    const j = jobRef.current;
    if (!j || j.tasks.some((t) => t.state === "todo" || t.state === "running")) return;
    const failed = j.tasks.filter((t) => t.state === "failed");
    const stopped = j.tasks.some((t) => t.state === "stopped");
    const text = failed.length
      ? `Finished, but ${failed.length} task${failed.length === 1 ? "" : "s"} failed - open the list below to see why.`
      : stopped
        ? "Stopped. Everything marked ✓ below went through."
        : "All done.";
    setMsgs((m) => [
      ...m,
      {
        from: "ai",
        text,
        summary: summarize(j.tasks, Math.round((Date.now() - j.started) / 1000)),
        steps: j.tasks.map((t) => ({
          ok: t.state === "done",
          tool: t.tool,
          text: `${t.label}${t.state === "stopped" ? " - stopped" : t.result ? ` - ${t.result}` : ""}`,
        })),
      },
    ]);
    putJob(null);
    router.refresh();
  }

  async function runQueue() {
    if (loopRef.current) return;
    loopRef.current = true;
    stopRef.current = false;
    const worker = async () => {
      for (;;) {
        if (stopRef.current) return;
        const j = jobRef.current;
        if (!j) return;
        const i = j.tasks.findIndex((t) => t.state === "todo");
        if (i < 0) return;
        patchTask(i, { state: "running" });
        const r = await execute(j.tasks[i]);
        patchTask(i, { state: r.ok ? "done" : "failed", result: r.text });
        if (r.ok) router.refresh();
      }
    };
    try {
      await Promise.all(Array.from({ length: WORKERS }, worker));
    } finally {
      loopRef.current = false;
      const j = jobRef.current;
      if (j && !stopRef.current && j.tasks.some((t) => t.state === "todo")) runQueue();
      else finish();
    }
  }

  function stop() {
    stopRef.current = true;
    const j = jobRef.current;
    if (!j) return;
    putJob({ ...j, tasks: j.tasks.map((t) => (t.state === "todo" ? { ...t, state: "stopped" as const } : t)) });
    if (!loopRef.current) finish();
  }

  useEffect(() => {
    setMsgs(loadChat());
    const saved = load<Job>(JOB_KEY);
    if (saved?.tasks?.length) {
      putJob({ ...saved, tasks: saved.tasks.map((t) => (t.state === "running" ? { ...t, state: "todo" as const } : t)) });
      runQueue();
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (msgs.length) localStorage.setItem(STORE_KEY, JSON.stringify({ msgs: msgs.slice(-60), last: Date.now() }));
      else localStorage.removeItem(STORE_KEY);
    } catch {}
  }, [msgs, loaded]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, thinking, open, job?.tasks.length]);

  function newChat() {
    if (thinking || working) return;
    if (msgs.length && !confirm("Start a new chat? The current conversation will be cleared.")) return;
    setMsgs([]);
  }

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || thinking) return;
    const idleExpired = msgs.length > 0 && loadChat().length === 0;
    const next: Msg[] = [...(idleExpired ? [] : msgs), { from: "me", text: msg }];
    setText("");
    setMsgs(next);
    setThinking(true);
    try {
      const running = (jobRef.current?.tasks || []).filter((x) => x.state === "todo" || x.state === "running").map((x) => x.label);
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running, messages: next.filter((m) => !m.error).map((m) => ({ from: m.from, text: m.text })) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 401) throw new Error("Your login expired. Reload the page and log in again.");
      const j = (await res.json().catch(() => null)) as { ok?: boolean; reply?: string; error?: string; tasks?: Omit<Task, "state">[] } | null;
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Request failed (${res.status})`);
      setMsgs((m) => [...m, { from: "ai", text: j.reply || "On it." }]);
      const tasks = (j.tasks || []).map((x) => ({ ...x, state: "todo" as const }));
      if (tasks.length) {
        const cur = jobRef.current;
        putJob(cur ? { ...cur, tasks: [...cur.tasks, ...tasks] } : { tasks, started: Date.now() });
        runQueue();
      }
    } catch (e) {
      const err = e instanceof Error ? (e.name === "TimeoutError" ? "I couldn't read that in time - Google's AI is slow right now. Please send it again." : e.message) : String(e);
      setMsgs((m) => [...m, { from: "ai", text: err, error: true }]);
    } finally {
      setThinking(false);
    }
  }

  const doneCount = job ? job.tasks.filter((t) => t.state === "done" || t.state === "failed" || t.state === "stopped").length : 0;

  return (
    <>
      {open && (
        <div className="panel fixed right-4 bottom-36 z-30 flex h-[min(600px,calc(100dvh-10rem))] w-[min(420px,calc(100vw-2rem))] flex-col shadow-2xl shadow-black/30 lg:right-6 lg:bottom-24">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/[0.07]">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <Icon name="sparkles" className="size-4 text-emerald-500" /> Writer assistant
              </div>
              <div className="mt-0.5 text-xs muted">
                Style v{version} · next lesson {Math.min(pending, need)}/{need} approved posts
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={newChat} disabled={thinking || working} className="btn btn-quiet px-2 py-1 text-xs" title="Start a new chat">
                <Icon name="chat" className="size-3.5" /> New chat
              </button>
              <button onClick={() => setOpen(false)} className="btn btn-quiet p-1.5" aria-label="Close">
                <Icon name="x" className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-4 text-sm">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="muted">
                  Tell me what you want done. I reply right away and hand the work to the writer, scheduler or style coach - you can keep
                  chatting while they work.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="btn btn-ghost px-2.5 py-1 text-xs whitespace-normal">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.from === "me" ? "justify-end" : ""}`}>
                <div
                  className={`max-w-[88%] min-w-0 rounded-2xl px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere] ${
                    m.from === "me"
                      ? "bg-emerald-500 text-slate-950"
                      : m.error
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : "bg-slate-100 dark:bg-white/5"
                  }`}
                >
                  {m.summary && (
                    <div
                      className={`mb-1.5 flex items-start gap-1.5 text-xs font-semibold ${
                        m.steps?.some((s) => !s.ok) ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      <span>{m.steps?.some((s) => !s.ok) ? "⚠" : "✓"}</span>
                      <span>{m.summary}</span>
                    </div>
                  )}
                  {m.text}
                  {m.steps && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer muted">
                        {m.steps.length} task{m.steps.length === 1 ? "" : "s"}
                        {m.steps.some((s) => !s.ok) ? ` · ${m.steps.filter((s) => !s.ok).length} not done` : ""}
                      </summary>
                      <ul className="mt-1 space-y-0.5">
                        {m.steps.map((s, j) => (
                          <li key={j} className={s.ok ? "muted" : "text-red-600 dark:text-red-400"}>
                            {s.ok ? "✓" : "✗"} {s.text}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex">
                <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2.5 dark:bg-white/5">
                  <Dots />
                </div>
              </div>
            )}

            {job && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-center gap-2.5">
                  {working ? <Spinner /> : <span className="text-emerald-500">✓</span>}
                  <span className="font-medium">
                    {working ? "Working" : "Finishing"} · {doneCount}/{job.tasks.length}
                  </span>
                  <span className="text-xs muted">
                    <Elapsed since={job.started} />
                  </span>
                  {working && (
                    <button onClick={stop} className="btn btn-quiet ml-auto px-2 py-0.5 text-xs">
                      Stop
                    </button>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/15">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${job.tasks.length ? (doneCount / job.tasks.length) * 100 : 0}%` }}
                  />
                </div>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                  {job.tasks.map((t, j) => (
                    <li key={j} className="flex items-start gap-2 [overflow-wrap:anywhere]">
                      <span className="mt-0.5 w-3.5 shrink-0 text-center">
                        {t.state === "running" ? (
                          <Spinner className="inline-block size-3" />
                        ) : t.state === "done" ? (
                          <span className="text-emerald-500">✓</span>
                        ) : t.state === "failed" ? (
                          <span className="text-red-500">✗</span>
                        ) : (
                          <span className="muted">○</span>
                        )}
                      </span>
                      <span className={t.state === "todo" || t.state === "stopped" ? "muted" : t.state === "failed" ? "text-red-600 dark:text-red-400" : ""}>
                        {t.label}
                        {t.state === "failed" && t.result ? ` - ${t.result}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {working && <p className="mt-2 text-xs muted">You can keep chatting. Keep this page open until it finishes.</p>}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            className="flex gap-2 border-t border-slate-200 p-3 dark:border-white/[0.07]"
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell me what to do..." className="input" />
            <button disabled={thinking || !text.trim()} className="btn btn-primary px-3" aria-label="Send">
              <Icon name="send" className="size-4" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-20 z-30 flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 lg:right-6 lg:bottom-6"
      >
        {(thinking || working) && !open ? (
          <span className="size-5 animate-spin rounded-full border-2 border-slate-950/25 border-t-slate-950" />
        ) : (
          <Icon name={open ? "x" : "chat"} className="size-5" />
        )}
        <span className="hidden sm:inline">
          {working && !open && job ? `Working ${doneCount}/${job.tasks.length}` : thinking && !open ? "Thinking..." : "Writer"}
        </span>
      </button>
    </>
  );
}
