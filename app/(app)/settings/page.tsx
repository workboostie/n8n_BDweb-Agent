import { getConfig } from "@/lib/n8n";
import { SettingsForm } from "@/components/SettingsForm";
import { GenerateButton } from "@/components/GenerateButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cfg = await getConfig();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm muted">How many posts get written and how they are planned.</p>
      </div>
      <SettingsForm
        initial={{
          posts_per_week: Number(cfg.posts_per_week || 50),
          follow_cta_rate: Math.round(Number(cfg.follow_cta_rate || 0.45) * 100),
          text_only_per_day: Number(cfg.text_only_per_day || 1),
          extra_post_day: cfg.extra_post_day || "Fri",
          paused: String(cfg.paused).toLowerCase() === "true",
        }}
      />
      <section className="panel space-y-3 p-5">
        <h2 className="font-semibold">Generate drafts now</h2>
        <p className="text-sm muted">
          New drafts are written automatically every Thursday at 8 AM for Saturday to Friday. Use this to fill any empty slots from tomorrow
          until the end of next week right away. Existing posts are never replaced.
        </p>
        <GenerateButton />
      </section>
    </div>
  );
}
