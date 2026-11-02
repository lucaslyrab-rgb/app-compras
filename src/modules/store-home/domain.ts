/**
 * Início da loja: transforma a situação do dia em cartões fáceis de ler.
 * Funções puras; a leitura do banco fica em repository.ts.
 */

export type StoreHomeOrder = {
  /** Pedido enviado (não cancelado) para o ciclo atual. */
  submittedAt: string | null;
  submittedItems: number;
  /** Rascunho do dia, quando ainda não foi enviado. */
  draftItems: number;
  cutoffAt: string;
  cycleDate: string;
};

export type StoreHomeConference = {
  cycleDate: string;
  status: "IN_PROGRESS" | "FINALIZED";
  totalItems: number;
  verifiedItems: number;
} | null;

export type StoreHomeLosses = {
  count: number;
  kg: number;
  und: number;
};

export type StoreHomeSummary = {
  order: StoreHomeOrder;
  conference: StoreHomeConference;
  losses: StoreHomeLosses;
};

export type CardTone = "integral" | "partial" | "total" | "pending" | "additional";

export type CardStatus = {
  tone: CardTone;
  label: string;
  detail: string;
  action: string;
};

function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function shortTime(iso: string, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function orderCardStatus(order: StoreHomeOrder, now: Date = new Date()): CardStatus {
  const cutoff = new Date(order.cutoffAt);
  const closed = now.getTime() > cutoff.getTime();
  if (order.submittedAt) {
    return {
      tone: "integral",
      label: "Enviado",
      detail: `Compra ${shortDate(order.cycleDate)} · ${plural(order.submittedItems, "produto", "produtos")} · enviado às ${shortTime(order.submittedAt)}`,
      action: closed ? "Ver pedido" : "Revisar pedido",
    };
  }
  if (closed) {
    return {
      tone: "total",
      label: "Prazo encerrado",
      detail: `Compra ${shortDate(order.cycleDate)} · o prazo terminou às ${shortTime(order.cutoffAt)}`,
      action: "Abrir pedido",
    };
  }
  return {
    tone: "partial",
    label: "Não enviado",
    detail:
      order.draftItems > 0
        ? `Rascunho · ${plural(order.draftItems, "produto", "produtos")} · envie até ${shortTime(order.cutoffAt)}`
        : `Compra ${shortDate(order.cycleDate)} · envie até ${shortTime(order.cutoffAt)}`,
    action: order.draftItems > 0 ? "Continuar pedido" : "Fazer pedido",
  };
}

export function conferencePercent(conference: StoreHomeConference): number {
  if (!conference || conference.totalItems <= 0) return 0;
  return Math.min(100, Math.round((conference.verifiedItems / conference.totalItems) * 100));
}

export function conferenceCardStatus(conference: StoreHomeConference): CardStatus {
  if (!conference) {
    return { tone: "pending", label: "Sem chegada", detail: "Nenhuma entrega para conferir ainda", action: "Abrir" };
  }
  const pending = Math.max(0, conference.totalItems - conference.verifiedItems);
  if (conference.status === "FINALIZED") {
    return {
      tone: "integral",
      label: "Finalizada",
      detail: `Compra ${shortDate(conference.cycleDate)} · ${plural(conference.totalItems, "item conferido", "itens conferidos")}`,
      action: "Ver conferência",
    };
  }
  return {
    tone: pending > 0 ? "partial" : "additional",
    label: pending > 0 ? `${pending} para pesar` : "Pronta para finalizar",
    detail: `Compra ${shortDate(conference.cycleDate)} · ${conference.verifiedItems} de ${conference.totalItems} pesados`,
    action: "Continuar conferência",
  };
}

export function formatLossTotal(losses: StoreHomeLosses): string {
  const parts: string[] = [];
  if (losses.kg > 0 || losses.und === 0) parts.push(`${losses.kg.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`);
  if (losses.und > 0) parts.push(`${losses.und.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} und`);
  return parts.join(" + ");
}

/** Aviso do rodapé: o que a loja ainda precisa fazer, na ordem de urgência. */
export function homeReminder(summary: StoreHomeSummary, now: Date = new Date()): string | null {
  const conference = summary.conference;
  if (conference && conference.status === "IN_PROGRESS") {
    const pending = Math.max(0, conference.totalItems - conference.verifiedItems);
    if (pending > 0) {
      return `A chegada de ${shortDate(conference.cycleDate)} ainda tem ${plural(pending, "item", "itens")} para pesar.`;
    }
    return `A conferência de ${shortDate(conference.cycleDate)} está pronta para finalizar.`;
  }
  if (!summary.order.submittedAt && now.getTime() <= new Date(summary.order.cutoffAt).getTime()) {
    return `O pedido da compra ${shortDate(summary.order.cycleDate)} ainda não foi enviado.`;
  }
  return null;
}
