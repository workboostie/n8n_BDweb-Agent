"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

type Step = { ok: boolean; text: string; tool?: string };
type Msg = { from: "me" | "ai"; text: string; error?: boolean; steps?: Step[]; summary?: string };
type Live = { status: string; steps: Step[]; started: number };

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

function summarize(steps: Step[], secs: number) {
  const counts = new Map<string, number>();
  for (const s of steps) if (s.ok && s.tool) counts.set(s.tool, (counts.get(s.tool) || 0) + 1);
  const parts: string[] = [];
  for (const [tool, n] of counts) {
    const posts = `${n} post${n === 1 ? "" : "s"}`;
    if (COUNTED[tool]) parts.push(COUNTED[tool].includes("#") ? COUNTED[tool].replace("#", posts) : `${COUNTED[tool]} ${posts}`);
    else if (ONCE[tool]) parts.push(ONCE[tool]);
  }
  const failed = steps.filter((s) => !s.ok).length;
  if (failed) parts.push(`${failed} failed`);
  const what = parts.length ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) : "No changes made";
  return `Done in ${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`} · ${what}`;
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

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tabular-nums">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}

const STORE_KEY = "writerChat";
const IDLE_MS = 6 * 60 * 60 * 1000;

const SUGGESTIONS = [
  "Delete the weakest drafts so each day from tomorrow has 5 posts",
  "Make the hooks shorter and sharper",
  "What's scheduled for tomorrow?",
];

function loadChat(): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null") as { msgs?: Msg[]; last?: number } | null;
    if (!raw?.msgs || !raw.last || Date.now() - raw.last > IDLE_MS) {
      localStorage.removeItem(STORE_KEY);
      return [];
    }
    return raw.msgs;
  } catch {
    return [];
  }
}

export function Assistant({ version, pending, need }: { version: number; pending: number; need: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs(loadChat());
    setLoaded(true);
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
  }, [msgs, busy, open, live?.status, live?.steps.length]);

  function newChat() {
    if (busy) return;
    if (msgs.length && !confirm("Start a new chat? The current conversation will be cleared.")) return;
    setMsgs([]);
  }

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy) return;
    const idleExpired = msgs.length > 0 && loadChat().length === 0;
    const next: Msg[] = [...(idleExpired ? [] : msgs), { from: "me", text: msg }];
    setText("");
    setMsgs(next);
    setBusy(true);
    const started = Date.now();
    setLive({ status: "Starting", steps: [], started });
    const done: Step[] = [];
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream: true, messages: next.filter((m) => !m.error).map((m) => ({ from: m.from, text: m.text })) }),
        signal: AbortSignal.timeout(295_000),
      });
      if (res.status === 401) throw new Error("Your login expired. Reload the page and log in again.");
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      type Ev =
        | { type: "status"; text: string }
        | { type: "step"; tool: string; ok: boolean; text: string }
        | { type: "done"; ok: boolean; reply?: string; error?: string; steps?: Step[] };
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let final: Extract<Ev, { type: "done" }> | null = null;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const lineText = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!lineText) continue;
          let ev: Ev;
          try {
            ev = JSON.parse(lineText) as Ev;
          } catch {
            continue;
          }
          if (ev.type === "status") setLive((l) => (l ? { ...l, status: ev.text } : l));
          else if (ev.type === "step") {
            done.push({ ok: ev.ok, tool: ev.tool, text: ev.text });
            setLive((l) => (l ? { ...l, steps: [...done] } : l));
          } else final = ev;
        }
        if (end) break;
      }
      if (!final) throw new Error("The connection dropped before I finished. Some changes may have gone through - check the posts.");
      if (!final.ok) throw new Error(final.error || "Something went wrong");
      const steps = final.steps?.length ? final.steps : done;
      setMsgs((m) => [
        ...m,
        {
          from: "ai",
          text: final.reply || "Done.",
          steps: steps.length ? steps : undefined,
          summary: steps.length ? summarize(steps, Math.round((Date.now() - started) / 1000)) : undefined,
        },
      ]);
      if (steps.length) router.refresh();
    } catch (e) {
      const err = e instanceof Error ? (e.name === "TimeoutError" ? "That took too long. Some changes may have gone through - check the posts, then try again." : e.message) : String(e);
      setMsgs((m) => [...m, { from: "ai", text: err, error: true, steps: done.length ? [...done] : undefined }]);
      if (done.length) router.refresh();
    } finally {
      setBusy(false);
      setLive(null);
    }
  }

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
              <button onClick={newChat} disabled={busy} className="btn btn-quiet px-2 py-1 text-xs" title="Start a new chat">
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
                  I can change, rewrite, move, approve, unschedule and delete posts, update settings and the writing style. Tell me what you
                  want done.
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
                        {m.steps.length} change{m.steps.length === 1 ? "" : "s"}
                        {m.steps.some((s) => !s.ok) ? ` · ${m.steps.filter((s) => !s.ok).length} failed` : ""}
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
            {busy && live && (
              <div className="flex">
                <div className="max-w-[88%] min-w-0 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-emerald-500/25 border-t-emerald-500" />
                    <span className="font-medium [overflow-wrap:anywhere]">{live.status}</span>
                    <Dots />
                  </div>
                  <div className="mt-1 text-xs muted">
                    Working · <Elapsed since={live.started} />
                    {live.steps.length > 0 && ` · ${live.steps.length} change${live.steps.length === 1 ? "" : "s"} so far`}
                  </div>
                  {live.steps.length > 0 && (
                    <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs">
                      {live.steps.slice(-6).map((s, j) => (
                        <li key={j} className={`[overflow-wrap:anywhere] ${s.ok ? "muted" : "text-red-600 dark:text-red-400"}`}>
                          {s.ok ? "✓" : "✗"} {s.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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
            <button disabled={busy || !text.trim()} className="btn btn-primary px-3" aria-label="Send">
              <Icon name="send" className="size-4" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-20 z-30 flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 lg:right-6 lg:bottom-6"
      >
        {busy && !open ? (
          <span className="size-5 animate-spin rounded-full border-2 border-slate-950/25 border-t-slate-950" />
        ) : (
          <Icon name={open ? "x" : "chat"} className="size-5" />
        )}
        <span className="hidden sm:inline">{busy && !open ? "Working..." : "Writer"}</span>
      </button>
    </>
  );
}
