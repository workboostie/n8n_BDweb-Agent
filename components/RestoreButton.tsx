"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restorePost } from "@/app/actions";

export function RestoreButton({ postKey }: { postKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        const r = await restorePost(postKey);
        setBusy(false);
        if (r.ok) router.push(`/?p=${postKey}`);
        else alert(r.error);
      }}
      disabled={busy}
      className="btn btn-ghost px-2.5 py-1.5 text-xs"
    >
      {busy ? "Restoring..." : "Restore"}
    </button>
  );
}
