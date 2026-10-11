"use client";

import { useActionState } from "react";
import { saveSettings } from "@/app/actions";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Initial = {
  posts_per_week: number;
  follow_cta_rate: number;
  text_only_per_day: number;
  extra_post_day: string;
  paused: boolean;
};

export function SettingsForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState(saveSettings, null);
  return (
    <form action={action} className="panel space-y-5 p-5">
      <h2 className="font-semibold">Posting</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="muted">Posts per week</span>
          <input name="posts_per_week" type="number" min={7} max={100} defaultValue={initial.posts_per_week} className="input" />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="muted">Extra posts go to (when not divisible by 7)</span>
          <select name="extra_post_day" defaultValue={initial.extra_post_day} className="input">
            {DAYS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="muted">Posts with a &quot;follow the page&quot; line (%)</span>
          <input name="follow_cta_rate" type="number" min={0} max={100} defaultValue={initial.follow_cta_rate} className="input" />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="muted">Text-only posts per day</span>
          <input name="text_only_per_day" type="number" min={0} max={5} defaultValue={initial.text_only_per_day} className="input" />
        </label>
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" name="paused" defaultChecked={initial.paused} className="size-4 accent-emerald-500" />
        Pause inbox and comment auto-replies
      </label>
      <div className="flex items-center gap-3 border-t border-slate-200 pt-4 dark:border-white/[0.07]">
        <button disabled={pending} className="btn btn-primary">
          {pending ? "Saving..." : "Save settings"}
        </button>
        {state && (
          <span className={`text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {state.ok ? state.message : state.error}
          </span>
        )}
        <span className="ml-auto hidden text-xs muted sm:inline">Posts per week applies from the next batch.</span>
      </div>
    </form>
  );
}
