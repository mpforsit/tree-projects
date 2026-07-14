"use client";

/**
 * Drill-down motion (handover §5): the target view scales 0.93 → 1 over
 * 240 ms with the transform-origin at the clicked card's position
 * (stored by the glance card just before navigation). Other entries use
 * the plain 180 ms view fade.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function ZoomIn({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cls, setCls] = useState("");

  useEffect(() => {
    let origin: { x: number; y: number } | null = null;
    try {
      const raw = sessionStorage.getItem("treeops.zoom");
      if (raw) {
        origin = JSON.parse(raw) as { x: number; y: number };
        sessionStorage.removeItem("treeops.zoom");
      }
    } catch {
      /* no zoom origin */
    }
    if (origin && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      ref.current.style.transformOrigin = `${origin.x - rect.left}px ${origin.y - rect.top}px`;
      setCls("zoom-in");
    } else {
      setCls("view-fade");
    }
  }, []);

  return (
    <div ref={ref} className={cls}>
      {children}
    </div>
  );
}
