"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { approvePost } from "@/app/actions";
import { dayLabel, fmtHHMM, fmtTime, formatName, hasImage, isTextOnly, liveStatus, needsImage, type Post } from "@/lib/posts";
import { PostEditor, type LocalEdit } from "./PostEditor";

const EDITS_KEY = "reviewEdits";
import { Icon } from "./Icon";

type Filter = "all" | "ready" | "image";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "image", label: "No image" },
];

export function ReviewClient({ posts, today, initialKey }: { posts: Post[]; today: string; initialKey?: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey || posts[0]?.post_key || null);
  const [mobileOpen, setMobileOpen] = useState(!!initialKey);
  const [bulk, setBulk] = useState<string | null>(null);
  const [listHidden, setListHidden] = useState(false);
  const [edits, setEdits] = useState<Record<string, LocalEdit>>({});
  const [editsLoaded, setEditsLoaded] = useState(false);

  useEffect(() => {
    try {
      setListHidden(localStorage.getItem("reviewList") === "hidden");
      const stored = JSON.parse(localStorage.getItem(EDITS_KEY) || "{}") as Record<string, LocalEdit>;
      const keys = new Set(posts.map((p) => p.post_key));
      setEdits(Object.fromEntries(Object.entries(stored).filter(([k]) => keys.has(k))));
    } catch {}
    setEditsLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setEdit(key: string, edit: LocalEdit | null) {
    setEdits((prev) => {
      const cur = prev[key];
      if (!edit && !cur) return prev;
      if (edit && cur && cur.caption === edit.caption && cur.date === edit.date && cur.time === edit.time) return prev;
      const next = { ...prev };
      if (edit) next[key] = edit;
      else delete next[key];
      try {
        localStorage.setItem(EDITS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function toggleList() {
    const next = !listHidden;
    setListHidden(next);
    try {
      localStorage.setItem("reviewList", next ? "hidden" : "shown");
    } catch {}
  }

  const list = useMemo(() => {
    if (filter === "ready") return posts.filter(hasImage);
    if (filter === "image") return posts.filter((p) => !hasImage(p));
    return posts;
  }, [posts, filter]);

  const ready = posts.filter(hasImage);
  const selected = posts.find((p) => p.post_key === selectedKey) || null;

  useEffect(() => {
    if (!selected && list.length) setSelectedKey(list[0].post_key);
  }, [selected, list]);

  const groups = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of list) m.set(p.post_date, [...(m.get(p.post_date) || []), p]);
    return [...m.entries()];
  }, [list]);

  function moveNext() {
    const i = list.findIndex((p) => p.post_key === selectedKey);
    const next = list[i + 1] || list[i - 1];
    setSelectedKey(next ? next.post_key : null);
    router.refresh();
  }

  async function approveAllReady() {
    if (!confirm(`Approve and schedule all ${ready.length} posts that have an image?`)) return;
    let failed = 0;
    for (let i = 0; i < ready.length; i++) {
      setBulk(`Scheduling ${i + 1}/${ready.length}...`);
      const p = ready[i];
      const e = edits[p.post_key];
      const changes = e
        ? {
            ...(e.caption !== p.caption ? { caption: e.caption } : {}),
            ...(e.date !== p.post_date || e.time !== fmtHHMM(p.planned_time) ? { date: e.date, time: e.time } : {}),
          }
        : {};
      const r = await approvePost(p.post_key, changes);
      if (r.ok) setEdit(p.post_key, null);
      else failed++;
    }
    setBulk(failed ? `${ready.length - failed} scheduled, ${failed} failed` : `All ${ready.length} scheduled`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-end justify-between gap-3 ${mobileOpen ? "hidden lg:flex" : ""}`}>
        <div>
          <h1 className="text-2xl font-semibold">Review</h1>
          <p className="mt-1 text-sm muted">
            {posts.length ? `${posts.length} drafts waiting · ${ready.length} ready with an image` : "You're all caught up."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {bulk && <span className="text-sm muted">{bulk}</span>}
          <button onClick={approveAllReady} disabled={!ready.length || (!!bulk && bulk.startsWith("Scheduling"))} className="btn btn-ghost">
            <Icon name="check" className="size-4" /> Approve all ready ({ready.length})
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="panel grid place-items-center gap-2 p-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
            <Icon name="check" className="size-6" />
          </span>
          <p className="font-medium">No drafts waiting</p>
          <p className="text-sm muted">New drafts arrive every Thursday morning, or generate them from Settings.</p>
        </div>
      ) : (
        <div className={`grid gap-4 ${listHidden ? "" : "lg:grid-cols-[300px_1fr]"}`}>
          <div
            className={`panel flex flex-col overflow-hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-8rem)] ${mobileOpen ? "hidden" : ""} ${
              listHidden ? "lg:hidden" : "lg:flex"
            }`}
          >
            <div className="flex gap-1 border-b border-slate-200 p-2 dark:border-white/[0.07]">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                    filter === f.id ? "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white" : "muted hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {groups.length === 0 && <p className="p-6 text-center text-sm muted">Nothing here.</p>}
              {groups.map(([date, items]) => (
                <div key={date} className="mb-2">
                  <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase muted">{dayLabel(date, today)}</div>
                  {items.map((p) => {
                    const active = p.post_key === selectedKey;
                    const expired = liveStatus(p) === "expired";
                    return (
                      <button
                        key={p.post_key}
                        onClick={() => {
                          setSelectedKey(p.post_key);
                          setMobileOpen(true);
                        }}
                        className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${
                          active ? "bg-emerald-500/10 ring-1 ring-emerald-500/40" : "hover:bg-slate-100 dark:hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold tabular-nums">{fmtTime(p.planned_time)}</span>
                          <span className="truncate capitalize muted">{formatName(p)}</span>
                          {edits[p.post_key] && (
                            <span className="badge gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300" title="Unsaved edits kept on this device">
                              <Icon name="save" className="size-3" /> Edited
                            </span>
                          )}
                          {expired ? (
                            <span className="badge ml-auto bg-red-500/15 text-red-600 dark:text-red-300">Time passed</span>
                          ) : needsImage(p) ? (
                            <span className="badge ml-auto bg-amber-500/15 text-amber-700 dark:text-amber-300">No image</span>
                          ) : (
                            !hasImage(p) &&
                            isTextOnly(p) && <span className="badge ml-auto bg-slate-500/15 text-slate-600 dark:text-slate-300">Text</span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{(edits[p.post_key]?.caption ?? p.caption).split("\n")[0]}</p>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className={mobileOpen ? "" : "hidden lg:block"}>
            {!editsLoaded ? (
              <div className="panel p-10 text-center text-sm muted">Loading...</div>
            ) : selected ? (
              <PostEditor
                key={selected.post_key}
                post={selected}
                edit={edits[selected.post_key]}
                onEdit={(e) => setEdit(selected.post_key, e)}
                onDone={moveNext}
                onBack={() => setMobileOpen(false)}
                listHidden={listHidden}
                onToggleList={toggleList}
                position={{ index: list.findIndex((p) => p.post_key === selected.post_key), total: list.length }}
                onStep={(d) => {
                  const i = list.findIndex((p) => p.post_key === selected.post_key);
                  const next = list[i + d];
                  if (next) setSelectedKey(next.post_key);
                }}
              />
            ) : (
              <div className="panel p-10 text-center text-sm muted">Select a post to review.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
