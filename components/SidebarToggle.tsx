"use client";

import { Icon } from "./Icon";

export function SidebarToggle() {
  function toggle() {
    const shell = document.getElementById("shell");
    if (!shell) return;
    const collapsed = !shell.hasAttribute("data-collapsed");
    shell.toggleAttribute("data-collapsed", collapsed);
    document.cookie = `sidebar=${collapsed ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      onClick={toggle}
      title="Collapse / expand menu"
      aria-label="Collapse or expand menu"
      className="btn btn-quiet w-full justify-start px-2.5 group-data-[collapsed]/shell:justify-center"
    >
      <Icon name="sidebar" className="size-[18px] shrink-0" />
      <span className="group-data-[collapsed]/shell:hidden">Collapse</span>
    </button>
  );
}
