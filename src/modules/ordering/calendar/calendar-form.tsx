"use client";

import { useState, useTransition } from "react";
import { savePurchaseCalendarAction } from "./actions";
import { isoWeekdays, type IsoWeekday, type PurchaseCalendar } from "./domain";

const weekdayLabels: Record<IsoWeekday, string> = {
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
  7: "Domingo",
};

export function PurchaseCalendarForm({ initial }: { initial: PurchaseCalendar }) {
  const [timezone, setTimezone] = useState(initial.timezone);
  const [cutoffTime, setCutoffTime] = useState(initial.cutoffTime);
  const [enabledDays, setEnabledDays] = useState<IsoWeekday[]>(initial.enabledIsoWeekdays);
  const [version, setVersion] = useState(initial.version);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function applyCalendar(calendar: PurchaseCalendar) {
    setTimezone(calendar.timezone);
    setCutoffTime(calendar.cutoffTime);
    setEnabledDays(calendar.enabledIsoWeekdays);
    setVersion(calendar.version);
  }

  function toggleDay(day: IsoWeekday) {
    setEnabledDays((current) =>
      current.includes(day) ? current.filter((currentDay) => currentDay !== day) : [...current, day].sort((a, b) => a - b),
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await savePurchaseCalendarAction({
        timezone,
        cutoffTime,
        enabledIsoWeekdays: enabledDays,
        expectedVersion: version,
      });
      if (result.status === "success") {
        applyCalendar(result.value);
        setFeedback({ error: false, message: "Calendário de compras salvo." });
        return;
      }
      if (result.status === "conflict") applyCalendar(result.value);
      setFeedback({ error: true, message: result.message });
    });
  }

  return <form className="manager-settings-form manager-calendar-form" onSubmit={submit}>
    <label>
      <span>Horário de corte</span>
      <input type="time" step="60" value={cutoffTime} onChange={(event) => setCutoffTime(event.target.value)} required />
    </label>
    <fieldset className="manager-calendar-days">
      <legend>Dias de compra</legend>
      <div>
        {isoWeekdays.map((day) => <label key={day}>
          <input type="checkbox" checked={enabledDays.includes(day)} onChange={() => toggleDay(day)} />
          <span>{weekdayLabels[day]}</span>
        </label>)}
      </div>
    </fieldset>
    <label>
      <span>Timezone operacional</span>
      <input value={timezone} onChange={(event) => setTimezone(event.target.value)} autoComplete="off" required />
    </label>
    <p className="manager-calendar-help">Novos pedidos usam a configuração vigente no envio. Ciclos já persistidos não são recalculados.</p>
    {feedback ? <p role="status" className={feedback.error ? "manager-feedback manager-feedback--error" : "manager-feedback manager-feedback--success"}>{feedback.message}</p> : null}
    <button className="manager-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar calendário"}</button>
  </form>;
}
