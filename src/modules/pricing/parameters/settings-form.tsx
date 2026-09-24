"use client";

import { useState, useTransition } from "react";
import { formatPricingNumber } from "../analysis/domain";
import { savePricingSettingsAction } from "./actions";
import type { PricingSettings } from "./domain";

export function PricingSettingsForm({ initial }: { initial: PricingSettings }) {
  const [operating, setOperating] = useState(formatPricingNumber(initial.operatingCostPercent));
  const [margin, setMargin] = useState(formatPricingNumber(initial.defaultMarginPercent));
  const [version, setVersion] = useState(initial.version);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await savePricingSettingsAction({ operatingCostPercent: operating, defaultMarginPercent: margin, expectedVersion: version });
      if (result.status === "success") {
        setVersion(result.value.version);
        setFeedback({ error: false, message: "Configurações salvas." });
      } else {
        if (result.status === "conflict") {
          setOperating(formatPricingNumber(result.value.operatingCostPercent));
          setMargin(formatPricingNumber(result.value.defaultMarginPercent));
          setVersion(result.value.version);
        }
        setFeedback({ error: true, message: result.message });
      }
    });
  }
  return <form className="manager-settings-form" onSubmit={submit}>
    <label><span>Custo operacional sobre o preço de venda</span><span className="manager-input-group"><input inputMode="decimal" value={operating} onChange={(event) => setOperating(event.target.value)} /><em>%</em></span></label>
    <label><span>Margem líquida padrão</span><span className="manager-input-group"><input inputMode="decimal" value={margin} onChange={(event) => setMargin(event.target.value)} /><em>%</em></span></label>
    <aside className="manager-info-box"><strong>Regra comercial</strong><p>Centavos de ,20 a ,60 usam final ,49. Nos demais casos o preço usa final ,99; abaixo de ,20 utiliza o ,99 imediatamente anterior.</p></aside>
    {feedback ? <p role="status" className={feedback.error ? "manager-feedback manager-feedback--error" : "manager-feedback manager-feedback--success"}>{feedback.message}</p> : null}
    <button className="manager-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar configurações"}</button>
  </form>;
}
