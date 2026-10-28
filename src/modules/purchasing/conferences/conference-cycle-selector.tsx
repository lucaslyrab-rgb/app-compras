"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

function formatCycleLabel(cycleDate: string): string {
  return cycleDate.split("-").reverse().join("/");
}

export function ConferenceCycleSelector({ cycleDate, cycles }: { cycleDate: string; cycles: string[] }) {
  const router = useRouter();

  if (cycles.length === 0) return null;

  const position = cycles.indexOf(cycleDate);
  const previous = position >= 0 ? cycles[position - 1] : undefined;
  const next = position >= 0 ? cycles[position + 1] : undefined;

  return (
    <nav
      aria-label="Ciclos de conferência"
      style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}
    >
      {previous ? (
        <Link href={`/conferencia?ciclo=${previous}`} className="btn btn--secondary" aria-label="Ciclo anterior" style={{ minHeight: 34, padding: "4px 10px" }}>
          ‹
        </Link>
      ) : (
        <button className="btn btn--secondary" disabled aria-label="Ciclo anterior" style={{ minHeight: 34, padding: "4px 10px" }}>
          ‹
        </button>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>CICLO:</span>
        <select
          aria-label="Ciclo de conferência"
          value={cycles.includes(cycleDate) ? cycleDate : ""}
          onChange={(event) => router.push(`/conferencia?ciclo=${event.target.value}`)}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 700 }}
        >
          {!cycles.includes(cycleDate) && <option value="">{formatCycleLabel(cycleDate)}</option>}
          {cycles.map((cycle) => (
            <option key={cycle} value={cycle}>
              {formatCycleLabel(cycle)}
            </option>
          ))}
        </select>
      </label>

      {next ? (
        <Link href={`/conferencia?ciclo=${next}`} className="btn btn--secondary" aria-label="Próximo ciclo" style={{ minHeight: 34, padding: "4px 10px" }}>
          ›
        </Link>
      ) : (
        <button className="btn btn--secondary" disabled aria-label="Próximo ciclo" style={{ minHeight: 34, padding: "4px 10px" }}>
          ›
        </button>
      )}
    </nav>
  );
}
