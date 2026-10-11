"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

type Msg = { from: "me" | "ai"; text: string; error?: boolean };

const SUGGESTIONS = ["Make the hooks shorter and sharper", "Use more real Bangladeshi examples", "What have you learned about my style?"];

export function Assistant({ version, pending, need }: { version: number; pending: number; need: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy) return;
    setText("");
    setMsgs((m) => [...m, { from: "me", text: msg }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg }),
        signal: AbortSignal.timeout(110_000),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; reply?: string; error?: string } | null;
      if (res.status === 401) throw new Error("Your login expired. Reload the page and log in again.");
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Request failed (${res.status})`);
      setMsgs((m) => [...m, { from: "ai", text: j.reply || "Done." }]);
      router.refresh();
    } catch (e) {
      const err = e instanceof Error ? (e.name === "TimeoutError" ? "The writer took too long to answer. Try again." : e.message) : String(e);
      setMsgs((m) => [...m, { from: "ai", text: err, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div className="panel fixed right-4 bottom-36 z-30 flex h-[min(520px,calc(100dvh-10rem))] w-[min(380px,calc(100vw-2rem))] flex-col shadow-2xl shadow-black/30 lg:right-6 lg:bottom-24">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-white/[0.07]">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <Icon name="sparkles" className="size-4 text-emerald-500" /> Writer assistant
              </div>
              <div className="mt-0.5 text-xs muted">
                Style v{version} · next lesson {Math.min(pending, need)}/{need} approved posts
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="btn btn-quiet p-1.5" aria-label="Close">
              <Icon name="x" className="size-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="muted">
                  I learn from every post you approve and study your edits after every {need}. Tell me how you want posts written and I
                  will apply it to all new drafts.
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
                  className={`max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap ${
                    m.from === "me"
                      ? "bg-emerald-500 text-slate-950"
                      : m.error
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : "bg-slate-100 dark:bg-white/5"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && <div className="text-xs muted">Thinking...</div>}
            <div ref={endRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            className="flex gap-2 border-t border-slate-200 p-3 dark:border-white/[0.07]"
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your writer..." className="input" />
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
        <Icon name={open ? "x" : "chat"} className="size-5" />
        <span className="hidden sm:inline">Writer</span>
      </button>
    </>
  );
}
