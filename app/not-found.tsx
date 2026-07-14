import { strings } from "@/lib/strings";

export default function NotFound() {
  return (
    <div style={{ margin: "18vh auto", textAlign: "center", color: "var(--mut)" }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)" }}>404</div>
      {strings.errors.notFound}
    </div>
  );
}
