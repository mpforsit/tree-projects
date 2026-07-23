import type { CSSProperties } from "react";

/**
 * App logo (brand package in public/logos). Renders both the light- and
 * dark-theme artwork; globals.css shows the right one for the active
 * `body[data-theme]` so there is no flash on theme boot. Works in both
 * server and client components (no hooks).
 */
type Variant = "horizontal" | "mark" | "stacked";

const SRC: Record<Variant, { light: string; dark: string }> = {
  horizontal: {
    light: "/logos/svg/lean-logo-horizontal.svg",
    dark: "/logos/svg/lean-logo-horizontal-white.svg",
  },
  mark: {
    light: "/logos/svg/lean-mark.svg",
    dark: "/logos/svg/lean-mark-white.svg",
  },
  stacked: {
    light: "/logos/svg/lean-logo-stacked.svg",
    dark: "/logos/svg/lean-logo-stacked-white.svg",
  },
};

export function Logo({
  variant = "horizontal",
  height = 24,
  style,
}: {
  variant?: Variant;
  height?: number;
  style?: CSSProperties;
}) {
  const src = SRC[variant];
  // No `display` here: the light/dark visibility is owned by CSS
  // (.lean-logo-light / .lean-logo-dark). An inline display would override
  // the class rule and render BOTH variants at once (ghosted wordmark).
  const img: CSSProperties = { height, width: "auto" };
  return (
    <span className="lean-logo" style={{ display: "inline-flex", ...style }}>
      <img className="lean-logo-light" src={src.light} alt="Lean" style={img} />
      <img className="lean-logo-dark" src={src.dark} alt="Lean" style={img} />
    </span>
  );
}
