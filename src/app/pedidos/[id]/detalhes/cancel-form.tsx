"use client";

import { useActionState } from "react";
import { cancelOrderAction } from "@/modules/ordering/actions";

export function CancelForm({ orderId, storeName }: { orderId: string; storeName: string }) {
  const [state, action, pending] = useActionState(cancelOrderAction, {});
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Cancelar o pedido?\n\n${storeName}\n\nEsta ação não poderá ser desfeita.`)) event.preventDefault(); }} className="stack cancel-form"><input type="hidden" name="orderId" value={orderId} /><label className="field"><span>Motivo (opcional)</span><input name="reason" maxLength={300} placeholder="Ex.: pedido duplicado" /></label><button className="btn btn--danger" disabled={pending}>{pending ? "Cancelando…" : "Cancelar pedido"}</button>{state.message ? <p className={state.status === "error" ? "error" : "success"}>{state.message}</p> : null}</form>;
}
