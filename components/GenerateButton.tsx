"use client";

import { useState } from "react";
import { generateNow } from "@/app/actions";
import { Icon } from "./Icon";

export function GenerateButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={async () => {
          if (!confirm("Write drafts for every empty slot until the end of next week?")) return;
          setBusy(true);
          const r = await generateNow();
          setBusy(false);
          setMsg(r.ok ? { ok: true, text: r.message || "Started" } : { ok: false, text: r.error });
        }}
        disabled={busy}
        className="btn btn-ghost"
      >
        <Icon name="sparkles" className="size-4" /> {busy ? "Starting..." : "Generate drafts now"}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.text}</span>}
    </div>
  );
}
