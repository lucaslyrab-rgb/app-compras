"use client";

import { useActionState, useState } from "react";
import { cancelStoreLossAsManagerAction, type LossActionState } from "./actions";

/**
 * Botão "Excluir" da Consulta de Perdas (Gestor). Abre um campo de motivo na
 * própria linha, sem janelas do navegador. A exclusão é lógica e auditada.
 */
export function ManagerLossCancel({ lossId, productName }: { lossId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, isPending] = useActionState<LossActionState, FormData>(cancelStoreLossAsManagerAction, {});

  if (state.status === "success") {
    return <span style={{ fontSize: 11, fontWeight: 700, color: "#166534" }}>Excluído</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn--secondary"
        aria-label={`Excluir lançamento de ${productName}`}
        style={{ fontSize: 11, padding: "4px 10px", minHeight: 30, borderRadius: 6, color: "#b91c1c", borderColor: "#fca5a5", fontWeight: 700 }}
      >
        ✕ Excluir
      </button>
    );
  }

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200 }}>
      <input type="hidden" name="lossId" value={lossId} />
      <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>
        Motivo da exclusão
        <input
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: lançamento duplicado"
          required
          minLength={3}
          maxLength={300}
          autoFocus
          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
        />
      </label>
      {state.status === "error" ? (
        <span role="alert" style={{ fontSize: 11, color: "#b91c1c", fontWeight: 600 }}>{state.message}</span>
      ) : null}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="submit"
          disabled={isPending || reason.trim().length < 3}
          className="btn"
          style={{ fontSize: 11, padding: "4px 10px", minHeight: 30, borderRadius: 6, background: "#b91c1c", fontWeight: 800 }}
        >
          {isPending ? "Excluindo..." : "Confirmar exclusão"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          disabled={isPending}
          className="btn btn--secondary"
          style={{ fontSize: 11, padding: "4px 10px", minHeight: 30, borderRadius: 6 }}
        >
          Voltar
        </button>
      </div>
    </form>
  );
}
