"use client";

import { useActionState, useState } from "react";
import { archiveCycleAction, type ArchiveCycleState } from "./actions";
import { describeStoreSituation, type OpenCycleSummary } from "./domain";

const cycleLabel = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

function CycleRow({ cycle }: { cycle: OpenCycleSummary }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, isPending] = useActionState<ArchiveCycleState, FormData>(archiveCycleAction, {});

  if (state.status === "success") {
    return (
      <li className="cycle-archive-row" style={{ color: "#166534", fontWeight: 700 }}>
        ✓ {state.message}
      </li>
    );
  }

  return (
    <li className="cycle-archive-row" style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <strong style={{ fontSize: 15 }}>Ciclo {cycleLabel(cycle.cycleDate)}</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "#334155" }}>
            <li>Destinação: {cycle.buyerStatus === "CLOSED" ? "fechada" : <strong>aberta</strong>}</li>
            {cycle.stores.map((s) => (
              <li key={s.storeId}>
                {s.storeName.replace("MultiShow ", "")}: {describeStoreSituation(s)}
              </li>
            ))}
          </ul>
        </div>
        {!open ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setOpen(true)}
            style={{ color: "#b91c1c", borderColor: "#fca5a5", fontWeight: 800 }}
          >
            Encerrar ciclo
          </button>
        ) : null}
      </div>

      {open ? (
        <form action={action} style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="hidden" name="cycleDate" value={cycle.cycleDate} />
          <p style={{ margin: 0, fontSize: 12, color: "#92400e", background: "#fef3c7", padding: "8px 10px", borderRadius: 6 }}>
            A Destinação será fechada e as conferências em andamento serão encerradas. O ciclo deixa de aparecer na
            Destinação e na Conferência das lojas, mas continua no Fechamento integrado. Nada é apagado.
          </p>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>
            Motivo do encerramento
            <input
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: ciclo de teste da implantação"
              required
              minLength={3}
              maxLength={300}
              style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}
            />
          </label>
          {state.status === "error" ? (
            <span role="alert" style={{ fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>{state.message}</span>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              className="btn"
              disabled={isPending || reason.trim().length < 3}
              style={{ background: "#b91c1c", fontWeight: 800 }}
            >
              {isPending ? "Encerrando..." : `Confirmar encerramento de ${cycleLabel(cycle.cycleDate)}`}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)} disabled={isPending}>
              Voltar
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export function CycleArchivePanel({ cycles }: { cycles: OpenCycleSummary[] }) {
  if (cycles.length === 0) {
    return <p style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ Nenhum ciclo antigo em aberto.</p>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {cycles.map((c) => (
        <CycleRow key={c.cycleDate} cycle={c} />
      ))}
    </ul>
  );
}
