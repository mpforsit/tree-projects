"use client";

/** Topbar search: `/` focuses it from anywhere (handover §6), Enter runs
 *  the query on the search screen. */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { strings } from "@/lib/strings";

export function SearchBox({ slug }: { slug: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      ref.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        router.push(`/${slug}/search?q=${encodeURIComponent(value.trim())}`);
      }}
    >
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={strings.search.placeholder}
        aria-label={strings.search.title}
        style={{
          width: 170,
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontSize: 12.5,
        }}
      />
    </form>
  );
}
