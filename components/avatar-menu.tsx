"use client";

/**
 * Avatar menu (handover §6 / spec §10): theme toggle, tenant switcher
 * (users with >1 membership), logout, "log out everywhere".
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { strings } from "@/lib/strings";

interface Props {
  displayName: string;
  tenants: { slug: string; name: string }[];
  activeSlug: string;
}

export function AvatarMenu({ displayName, tenants, activeSlug }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function toggleTheme() {
    const dark = document.body.dataset.theme === "dark";
    if (dark) {
      delete document.body.dataset.theme;
      localStorage.setItem("treeops.theme", "light");
    } else {
      document.body.dataset.theme = "dark";
      localStorage.setItem("treeops.theme", "dark");
    }
  }

  async function logout(everywhere: boolean) {
    if (everywhere) {
      await authClient.revokeSessions();
    }
    await authClient.signOut();
    router.push("/login");
  }

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 12px",
    border: "none",
    background: "none",
    color: "var(--ink)",
    fontSize: 13,
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={displayName}
        data-testid="avatar-button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--chipbg)",
          color: "var(--text2)",
          fontSize: 11.5,
          fontWeight: 650,
        }}
      >
        {initials}
      </button>
      {open && (
        <div
          data-testid="avatar-menu"
          style={{
            position: "absolute",
            right: 0,
            top: 38,
            minWidth: 220,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 3px 14px rgba(40,35,20,.07)",
            padding: "6px 0",
            zIndex: 10,
          }}
        >
          <button type="button" style={item} onClick={toggleTheme}>
            {strings.shell.themeToggle}
          </button>
          {tenants.length > 1 && (
            <>
              <div
                style={{
                  padding: "8px 12px 2px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: ".09em",
                  fontWeight: 650,
                  color: "var(--faint)",
                }}
              >
                {strings.shell.switchTenant}
              </div>
              {tenants.map((t) => (
                <Link
                  key={t.slug}
                  href={`/${t.slug}`}
                  style={{
                    ...item,
                    fontWeight: t.slug === activeSlug ? 650 : 400,
                  }}
                  onClick={() => setOpen(false)}
                >
                  {t.name}
                </Link>
              ))}
            </>
          )}
          <div style={{ borderTop: "1px solid var(--border2)", margin: "6px 0" }} />
          <button type="button" style={item} onClick={() => void logout(false)}>
            {strings.shell.logout}
          </button>
          <button
            type="button"
            style={{ ...item, color: "var(--mut)" }}
            onClick={() => void logout(true)}
          >
            {strings.shell.logoutEverywhere}
          </button>
        </div>
      )}
    </div>
  );
}
