"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { approvePost, newImagePrompt, removeImage, rewritePost, saveDraft, skipPost, type ActionResult, type PostChanges } from "@/app/actions";
import { compressImage } from "@/lib/image";
import { fmtHHMM, formatName, isTextOnly, liveStatus, needsImage, wordCount, type Post } from "@/lib/posts";
import { Icon } from "./Icon";

export type LocalEdit = { caption: string; date: string; time: string };

export function PostEditor({
  post,
  edit,
  onEdit,
  onDone,
  onBack,
  listHidden,
  onToggleList,
  position,
  onStep,
}: {
  post: Post;
  edit?: LocalEdit;
  onEdit: (edit: LocalEdit | null) => void;
  onDone: () => void;
  onBack: () => void;
  listHidden: boolean;
  onToggleList: () => void;
  position: { index: number; total: number };
  onStep: (delta: number) => void;
}) {
  const router = useRouter();
  const [caption, setCaption] = useState(edit?.caption ?? post.caption);
  const [date, setDate] = useState(edit?.date ?? post.post_date);
  const [time, setTime] = useState(edit?.time ?? fmtHHMM(post.planned_time));
  const syncFromServer = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const captionDirty = caption !== post.caption;
  const timeDirty = date !== post.post_date || time !== fmtHHMM(post.planned_time);
  const dirty = captionDirty || timeDirty;
  const expired = liveStatus(post) === "expired";
  const noImage = needsImage(post);
  const textOnly = isTextOnly(post);

  const changes = (): PostChanges => ({
    ...(captionDirty ? { caption } : {}),
    ...(timeDirty ? { date, time } : {}),
  });

  const serverTime = fmtHHMM(post.planned_time);

  useEffect(() => {
    if (syncFromServer.current) {
      syncFromServer.current = false;
      setCaption(post.caption);
      setDate(post.post_date);
      setTime(serverTime);
    }
  }, [post.caption, post.post_date, serverTime]);

  useEffect(() => {
    onEdit(dirty ? { caption, date, time } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caption, date, time, dirty]);

  async function act(label: string, fn: () => Promise<ActionResult>, after?: "next" | "refresh") {
    setBusy(label);
    setError(null);
    setNote(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (after === "next") {
      onEdit(null);
      return onDone();
    }
    if (label === "save" || label === "rewrite") syncFromServer.current = true;
    setNote(r.message || null);
    router.refresh();
  }

  const save = () => act("save", () => saveDraft(post.post_key, changes()));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !busy) save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const blob = await compressImage(file);
      const fd = new FormData();
      fd.set("post_key", post.post_key);
      fd.set("file", blob, `${post.post_key}.jpg`);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) throw new Error(j.error || `Upload failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <article className="panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3.5 dark:border-white/[0.07]">
        <button onClick={onBack} className="btn btn-quiet -ml-2 px-2 lg:hidden" aria-label="Back to list">
          <Icon name="back" className="size-5" />
        </button>
        <button
          onClick={onToggleList}
          className="btn btn-quiet -ml-2 hidden px-2 lg:inline-flex"
          title={listHidden ? "Show post list" : "Hide post list (focus on editor)"}
          aria-label={listHidden ? "Show post list" : "Hide post list"}
        >
          <Icon name="sidebar" className="size-[18px]" />
        </button>
        <span className="font-semibold capitalize">{formatName(post)}</span>
        <span className="text-sm muted">· {post.pillar}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={save}
            disabled={!dirty || !!busy}
            title={dirty ? "Save changes (Ctrl+S)" : "No unsaved changes"}
            aria-label="Save changes"
            className={`btn px-2 py-1 ${dirty ? "btn-ghost border-amber-500/50 text-amber-700 dark:text-amber-300" : "btn-quiet"}`}
          >
            <Icon name="save" className="size-4" />
            <span className="text-xs">{busy === "save" ? "Saving..." : dirty ? "Save" : "Saved"}</span>
          </button>
          <span className="mx-1 text-xs muted">#{post.post_key}</span>
          {position.index >= 0 && position.total > 1 && (
            <>
              <button onClick={() => onStep(-1)} disabled={position.index === 0} className="btn btn-quiet px-1.5 py-1" aria-label="Previous post">
                <Icon name="back" className="size-4" />
              </button>
              <span className="text-xs tabular-nums muted">
                {position.index + 1}/{position.total}
              </span>
              <button
                onClick={() => onStep(1)}
                disabled={position.index >= position.total - 1}
                className="btn btn-quiet px-1.5 py-1"
                aria-label="Next post"
              >
                <Icon name="next" className="size-4" />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={Math.max(14, caption.split("\n").length + 3)}
            className="input min-h-[22rem] flex-1 resize-y p-5 text-base leading-relaxed lg:min-h-[calc(100dvh-20rem)]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs muted">
            <span>{wordCount(caption)} words</span>
            {dirty && (
              <>
                <span className="text-amber-600 dark:text-amber-300">Unsaved changes, kept on this device</span>
                <button onClick={save} disabled={!!busy} className="font-medium text-emerald-600 dark:text-emerald-400">
                  {busy === "save" ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    if (!confirm("Discard your unsaved changes to this post?")) return;
                    setCaption(post.caption);
                    setDate(post.post_date);
                    setTime(fmtHHMM(post.planned_time));
                  }}
                  className="hover:text-slate-800 dark:hover:text-slate-200"
                >
                  Undo
                </button>
              </>
            )}
          </div>
        </div>

        <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium muted">
              <Icon name="clock" className="size-3.5" /> Posts on
            </div>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
            <p className={`text-xs ${expired && !timeDirty ? "text-red-600 dark:text-red-300" : "muted"}`}>
              {expired && !timeDirty ? "This time has passed. Pick a new one, or it posts 15 min after approval." : "Picked automatically. Change it if you like."}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium muted">
              <Icon name="image" className="size-3.5" /> Image
              <span
                className={`badge ml-auto ${textOnly ? "bg-slate-500/15 text-slate-600 dark:text-slate-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}
                title="What the AI recommends for this post. You can change it."
              >
                <Icon name="sparkles" className="size-3" /> AI: {textOnly ? "text only" : "with image"}
              </span>
            </div>
            {post.telegram_file_id ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/image/${encodeURIComponent(post.telegram_file_id)}`}
                  alt=""
                  className="aspect-[5/3] w-full rounded-lg bg-slate-100 object-cover dark:bg-white/5"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="btn btn-ghost px-2 py-1.5 text-xs">
                    <Icon name="upload" className="size-3.5" /> {busy === "upload" ? "Uploading..." : "Replace"}
                  </button>
                  <button
                    onClick={() => confirm("Remove the image? The post will go out as text only.") && act("remove", () => removeImage(post.post_key))}
                    disabled={!!busy}
                    className="btn btn-ghost px-2 py-1.5 text-xs hover:text-red-500"
                  >
                    <Icon name="x" className="size-3.5" /> {busy === "remove" ? "Removing..." : "Remove"}
                  </button>
                </div>
              </div>
            ) : textOnly ? (
              <div className="space-y-2 rounded-lg bg-slate-100 p-3 dark:bg-white/5">
                <p className="flex items-center gap-2 text-sm muted">
                  <Icon name="text" className="size-4" /> Posts as text only.
                </p>
                <p className="text-xs muted">Want an image anyway? Get a prompt or upload your own.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => act("prompt", () => newImagePrompt(post.post_key))} disabled={!!busy} className="btn btn-ghost px-2 py-1.5 text-xs">
                    <Icon name="sparkles" className="size-3.5" /> {busy === "prompt" ? "Writing..." : "Get prompt"}
                  </button>
                  <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="btn btn-ghost px-2 py-1.5 text-xs">
                    <Icon name="upload" className="size-3.5" /> {busy === "upload" ? "..." : "Upload"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-xs text-amber-700 dark:text-amber-300">No image yet. Without one, it posts as text only.</p>
                <p className="line-clamp-5 text-xs text-slate-600 dark:text-slate-300">{post.image_prompt}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(post.image_prompt);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="btn btn-ghost px-2 py-1.5 text-xs"
                  >
                    <Icon name="copy" className="size-3.5" /> {copied ? "Copied" : "Copy prompt"}
                  </button>
                  <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="btn btn-primary px-2 py-1.5 text-xs">
                    <Icon name="upload" className="size-3.5" /> {busy === "upload" ? "..." : "Upload"}
                  </button>
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </div>
        </aside>
      </div>

      {rewriteOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("rewrite", () => rewritePost(post.post_key, feedback, changes())).then(() => {
              setRewriteOpen(false);
              setFeedback("");
            });
          }}
          className="flex flex-col gap-2 px-5 pb-4 sm:flex-row"
        >
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change? e.g. stronger hook, add an example"
            className="input"
            autoFocus
          />
          <button disabled={!!busy} className="btn btn-ghost">
            <Icon name="sparkles" className="size-4" /> {busy === "rewrite" ? "Rewriting..." : "Rewrite"}
          </button>
        </form>
      )}

      {(error || note) && (
        <p className={`px-5 pb-3 text-sm ${error ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>{error || note}</p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-4 dark:border-white/[0.07]">
        <button
          onClick={() => act("approve", () => approvePost(post.post_key, changes()), "next")}
          disabled={!!busy || !caption.trim()}
          className="btn btn-primary"
        >
          <Icon name="check" className="size-4" />
          {busy === "approve" ? "Scheduling..." : `${dirty ? "Save & approve" : "Approve"}${post.telegram_file_id ? "" : " as text"}`}
        </button>
        <button onClick={() => setRewriteOpen((v) => !v)} disabled={!!busy} className="btn btn-ghost">
          <Icon name="sparkles" className="size-4" /> Rewrite with AI
        </button>
        <button onClick={() => act("prompt", () => newImagePrompt(post.post_key))} disabled={!!busy} className="btn btn-ghost">
          <Icon name="image" className="size-4" /> {busy === "prompt" ? "Writing..." : "New image prompt"}
        </button>
        <button onClick={() => act("skip", () => skipPost(post.post_key), "next")} disabled={!!busy} className="btn btn-quiet ml-auto hover:text-red-500">
          {busy === "skip" ? "Skipping..." : "Skip"}
        </button>
        {noImage && <p className="w-full text-xs text-amber-600 dark:text-amber-300">The AI suggested an image for this post. Approving now posts it as text only.</p>}
      </footer>
    </article>
  );
}
