"use client";

/**
 * Login per design handover §4 "Login" (English by design): email →
 * 6-box code entry (auto-advance, backspace, one-time-code) → success.
 * Uniform responses regardless of account existence (spec §8.1).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/logo";
import { strings } from "@/lib/strings";

const s = strings.login;

type Step = "email" | "code" | "success";

export function LoginForm({ entra }: { entra: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxesRef = useRef<(HTMLInputElement | null)[]>([]);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; sso?: boolean };
      if (data.sso) {
        setMessage(s.ssoEnforced);
        return;
      }
      setMessage(s.codeRequested);
      setDigits(Array(6).fill(""));
      setStep("code");
      setTimeout(() => boxesRef.current[0]?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.emailOtp({ email, otp: code });
    setBusy(false);
    if (err) {
      setError(s.invalidCode);
      setDigits(Array(6).fill(""));
      boxesRef.current[0]?.focus();
      return;
    }
    setStep("success");
  }

  function onDigit(index: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (!clean) return;
    const next = [...digits];
    // paste of a full code into any box
    if (clean.length > 1) {
      for (let i = 0; i < 6; i++) next[i] = clean[i] ?? "";
    } else {
      next[index] = clean;
    }
    setDigits(next);
    const firstEmpty = next.findIndex((d) => d === "");
    if (firstEmpty === -1) {
      void verify(next.join(""));
    } else {
      boxesRef.current[Math.max(firstEmpty, index + 1)]?.focus();
    }
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        setDigits(next);
      } else if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        boxesRef.current[index - 1]?.focus();
      }
    }
  }

  const panel: React.CSSProperties = {
    maxWidth: 360,
    margin: "12vh auto 0",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "32px 28px",
  };

  return (
    <div style={panel}>
      <Logo variant="horizontal" height={30} style={{ marginBottom: 18 }} />

      {step === "email" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
        >
          <h1 style={{ fontSize: 22, margin: "0 0 14px" }}>{s.welcome}</h1>
          <label style={{ fontSize: 12, color: "var(--mut)" }}>
            {s.emailLabel}
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: "9px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface2)",
                color: "var(--ink)",
              }}
            />
          </label>
          {message && (
            <p role="status" style={{ fontSize: 12.5, color: "var(--mut)" }}>
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              marginTop: 14,
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "var(--btn)",
              color: "var(--btnfg)",
              fontWeight: 600,
            }}
          >
            {s.continueWithEmail}
          </button>
          {entra && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "16px 0",
                  color: "var(--faint)",
                  fontSize: 11,
                }}
              >
                <span style={{ flex: 1, borderTop: "1px solid var(--border2)" }} />
                {s.or}
                <span style={{ flex: 1, borderTop: "1px solid var(--border2)" }} />
              </div>
              <button
                type="button"
                onClick={() =>
                  void authClient.signIn.oauth2({ providerId: "entra", callbackURL: "/" })
                }
                style={{
                  width: "100%",
                  padding: "10px 0",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface2)",
                  color: "var(--ink)",
                  fontWeight: 600,
                }}
              >
                {s.signInWithMicrosoft}
              </button>
            </>
          )}
        </form>
      )}

      {step === "code" && (
        <div>
          <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>{s.checkInbox}</h1>
          <p style={{ fontSize: 12.5, color: "var(--mut)", margin: "0 0 16px" }}>
            {s.codeSentTo(email)}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  boxesRef.current[i] = el;
                }}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${i + 1}`}
                value={d}
                onChange={(e) => onDigit(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                style={{
                  width: 44,
                  height: 52,
                  textAlign: "center",
                  fontSize: 20,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: `1px solid ${error ? "var(--al-over)" : "var(--border)"}`,
                  background: "var(--surface2)",
                  color: "var(--ink)",
                }}
              />
            ))}
          </div>
          {error && (
            <p
              role="alert"
              data-testid="otp-error"
              style={{ fontSize: 12.5, color: "var(--al-over)" }}
            >
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void requestCode()}
            style={{
              marginTop: 14,
              border: "none",
              background: "none",
              color: "var(--tealh)",
              fontSize: 12.5,
              padding: 0,
            }}
          >
            {s.sendNewCode}
          </button>
        </div>
      )}

      {step === "success" && (
        <div style={{ textAlign: "center" }}>
          <div aria-hidden style={{ fontSize: 34, color: "var(--teal)" }}>
            ✓
          </div>
          <h1 style={{ fontSize: 22, margin: "6px 0 18px" }}>{s.youAreIn}</h1>
          <button
            type="button"
            onClick={() => router.push("/")}
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "var(--btn)",
              color: "var(--btnfg)",
              fontWeight: 600,
            }}
          >
            {s.openLean}
          </button>
        </div>
      )}

      <p style={{ marginTop: 22, fontSize: 11, color: "var(--faint)", textAlign: "center" }}>
        {s.invitationOnly}
      </p>
    </div>
  );
}
