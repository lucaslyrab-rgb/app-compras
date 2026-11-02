import Link from "next/link";
import { redirect } from "next/navigation";
import { StoreNavigation } from "@/components/store-navigation";
import { hasPermission, resolveOperationalRoute } from "@/modules/identity/domain";
import { requirePrincipal } from "@/modules/identity/session";
import { currentPurchaseCycle } from "@/modules/ordering/calendar/service";
import { getStoreName } from "@/modules/ordering/repository";
import {
  conferenceCardStatus,
  conferencePercent,
  formatLossTotal,
  homeReminder,
  orderCardStatus,
  type StoreHomeSummary,
} from "@/modules/store-home/domain";
import { readStoreHomeSummary } from "@/modules/store-home/repository";
import "./styles.css";

export const dynamic = "force-dynamic";

function Icon({ name }: { name: "order" | "scale" | "trash" | "clock" | "info" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    order: (
      <>
        <path d="M9 5h10M9 12h10M9 19h10" />
        <path d="M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2" />
      </>
    ),
    scale: (
      <>
        <path d="M5 20h14M12 4v16M6 8h12" />
        <path d="M6 8l-3 6a3 3 0 006 0zM18 8l-3 6a3 3 0 006 0z" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
  };
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export default async function StartPage() {
  const principal = await requirePrincipal();
  const hasOrderPermission = hasPermission(principal, "pedidos:criar");
  const hasConferencePermission = hasPermission(principal, "loja:conferencia");
  const hasLossPermission = hasPermission(principal, "loja:perdas");
  const hasHistoryPermission = hasPermission(principal, "pedidos:historico");

  if (!principal.storeId || !(hasOrderPermission || hasConferencePermission || hasLossPermission)) {
    redirect(resolveOperationalRoute(principal) ?? "/sem-acesso");
  }

  const storeName = await getStoreName(principal.storeId);
  const shortName = storeName.replace(/^MultiShow\s+/i, "");

  // A situação do dia é um complemento: se a leitura falhar, os atalhos continuam funcionando.
  let summary: StoreHomeSummary | null = null;
  try {
    const cycle = await currentPurchaseCycle();
    summary = await readStoreHomeSummary({
      storeId: principal.storeId,
      orderDate: cycle.localDate,
      cycleDate: cycle.cycleDate,
      cutoffAt: cycle.cutoffAt,
    });
  } catch {
    summary = null;
  }

  const now = new Date();
  const order = summary ? orderCardStatus(summary.order, now) : null;
  const conference = summary ? conferenceCardStatus(summary.conference) : null;
  const percent = summary ? conferencePercent(summary.conference) : 0;
  const reminder = summary ? homeReminder(summary, now) : null;
  const cycleLabel = summary
    ? summary.order.cycleDate.split("-").reverse().slice(0, 2).join("/")
    : null;

  return (
    <div className="store-home">
      <StoreNavigation
        storeName={storeName}
        hasOrderPermission={hasOrderPermission}
        hasConferencePermission={hasConferencePermission}
        hasLossPermission={hasLossPermission}
      />
      <main className="store-home__main">
        <div className="store-home__intro">
          <div>
            <span className="store-home__hello">Olá, {shortName}</span>
            <h1>O que vamos fazer?</h1>
          </div>
          {cycleLabel ? <span className="store-home__cycle">Compra {cycleLabel}</span> : null}
        </div>

        {hasOrderPermission ? (
          <Link href="/" className="store-home__card store-home__card--primary">
            <span className="store-home__card-row">
              <span className="store-home__icon store-home__icon--brand"><Icon name="order" /></span>
              <span className="store-home__card-text">
                <strong>Pedido de hoje</strong>
                <span>{order?.detail ?? "Monte e envie o pedido da loja"}</span>
              </span>
              {order ? <span className={`status-tag status-tag--${order.tone}`}>{order.label}</span> : null}
            </span>
            <span className="store-home__card-foot">
              <span>Estoque e quantidades de cada produto</span>
              <strong>{order?.action ?? "Abrir pedido"}</strong>
            </span>
          </Link>
        ) : null}

        {hasConferencePermission ? (
          <Link href="/conferencia" className="store-home__card">
            <span className="store-home__card-row">
              <span className="store-home__icon store-home__icon--blue"><Icon name="scale" /></span>
              <span className="store-home__card-text">
                <strong>Conferência da chegada</strong>
                <span>{conference?.detail ?? "Pese o que chegou do CEASA"}</span>
              </span>
              {conference ? <span className={`status-tag status-tag--${conference.tone}`}>{conference.label}</span> : null}
            </span>
            {summary?.conference ? (
              <span className="store-home__progress" aria-label={`${percent}% conferido`}>
                <span style={{ width: `${percent}%` }} />
              </span>
            ) : null}
          </Link>
        ) : null}

        <div className="store-home__grid">
          {hasLossPermission ? (
            <Link href="/perdas" className="store-home__card store-home__card--small">
              <span className="store-home__icon store-home__icon--red"><Icon name="trash" /></span>
              <strong>Perdas</strong>
              <span>
                {summary
                  ? summary.losses.count > 0
                    ? <>Hoje: <b>{formatLossTotal(summary.losses)}</b> em {summary.losses.count} {summary.losses.count === 1 ? "lançamento" : "lançamentos"}</>
                    : "Nenhuma perda lançada hoje"
                  : "Registre o que foi descartado"}
              </span>
            </Link>
          ) : null}
          {hasHistoryPermission ? (
            <Link href="/historico" className="store-home__card store-home__card--small">
              <span className="store-home__icon store-home__icon--gray"><Icon name="clock" /></span>
              <strong>Histórico</strong>
              <span>Pedidos e conferências anteriores</span>
            </Link>
          ) : null}
        </div>

        {reminder ? (
          <p className="store-home__reminder" role="status">
            <Icon name="info" />
            <span>{reminder}</span>
          </p>
        ) : null}
      </main>
    </div>
  );
}
