"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Review", icon: "inbox" },
  { href: "/schedule", label: "Schedule", icon: "calendar" },
  { href: "/published", label: "Published", icon: "send" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function Nav({ mobile = false, drafts = 0 }: { mobile?: boolean; drafts?: number }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  if (mobile) {
    return (
      <nav className="grid grid-cols-4">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] ${
              isActive(l.href) ? "text-emerald-500 dark:text-emerald-400" : "muted"
            }`}
          >
            <Icon name={l.icon} className="size-5" />
            {l.label}
            {l.href === "/" && drafts > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2 rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-slate-950">
                {drafts}
              </span>
            )}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          title={l.label}
          className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors group-data-[collapsed]/shell:justify-center group-data-[collapsed]/shell:px-0 group-data-[collapsed]/shell:py-2.5 ${
            isActive(l.href)
              ? "bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-300"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
          }`}
        >
          <Icon name={l.icon} className="size-[18px] shrink-0" />
          <span className="group-data-[collapsed]/shell:hidden">{l.label}</span>
          {l.href === "/" && drafts > 0 && (
            <>
              <span className="ml-auto rounded-full bg-emerald-500/15 px-2 text-xs font-semibold text-emerald-700 group-data-[collapsed]/shell:hidden dark:text-emerald-300">
                {drafts}
              </span>
              <span className="absolute top-1 right-1.5 hidden min-w-4 rounded-full bg-emerald-500 px-1 text-center text-[9px] leading-4 font-semibold text-slate-950 group-data-[collapsed]/shell:block">
                {drafts}
              </span>
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}
