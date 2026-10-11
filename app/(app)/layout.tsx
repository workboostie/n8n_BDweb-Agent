import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Assistant } from "@/components/Assistant";
import { Icon } from "@/components/Icon";
import { logout } from "@/app/actions";
import { getConfig, getExamples, getPosts } from "@/lib/n8n";
import { liveStatus } from "@/lib/posts";

async function loadShell() {
  try {
    const [cfg, examples, posts] = await Promise.all([getConfig(), getExamples(), getPosts()]);
    return {
      drafts: posts.filter((p) => liveStatus(p) === "draft").length,
      version: Number(cfg.style_version || 0),
      pending: examples.filter((e) => !Number(e.learned_version)).length,
      need: Math.max(1, Number(cfg.learn_batch_size || 10)),
    };
  } catch {
    return { drafts: 0, version: 0, pending: 0, need: 10 };
  }
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-500 dark:text-emerald-400">
        <Icon name="logo" className="size-5" />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold">WebShop</div>
        <div className="text-[10px] tracking-wider uppercase muted">for business</div>
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const shell = await loadShell();
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex dark:border-white/[0.07] dark:bg-[#0d1626]">
        <Logo />
        <div className="mt-8 flex-1">
          <Nav drafts={shell.drafts} />
        </div>
        <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-white/[0.07]">
          <ThemeToggle withLabel />
          <form action={logout}>
            <button className="btn btn-quiet w-full justify-start px-2.5">
              <Icon name="logout" className="size-[18px]" /> Log out
            </button>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-white/[0.07] dark:bg-[#0b1220]/90">
        <Logo />
        <div className="flex items-center">
          <ThemeToggle />
          <form action={logout}>
            <button className="btn btn-quiet px-2.5" aria-label="Log out">
              <Icon name="logout" className="size-[18px]" />
            </button>
          </form>
        </div>
      </header>

      <main className="px-4 pt-5 pb-28 lg:ml-60 lg:px-8 lg:pt-8 lg:pb-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden dark:border-white/[0.07] dark:bg-[#0d1626]/95">
        <Nav mobile drafts={shell.drafts} />
      </div>

      <Assistant version={shell.version} pending={shell.pending} need={shell.need} />
    </div>
  );
}
