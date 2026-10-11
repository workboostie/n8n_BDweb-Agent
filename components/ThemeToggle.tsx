"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      className={`btn btn-quiet px-2.5 ${withLabel ? "w-full justify-start group-data-[collapsed]/shell:justify-center" : ""}`}
      aria-label="Toggle theme"
      title={dark ? "Light mode" : "Dark mode"}
    >
      <Icon name={dark ? "sun" : "moon"} className="size-[18px] shrink-0" />
      {withLabel && <span className="group-data-[collapsed]/shell:hidden">{dark ? "Light mode" : "Dark mode"}</span>}
    </button>
  );
}
