import Link from "next/link";
import { ProductPhoto } from "@/components/product-photo";
import type { StoreLossRecord } from "./domain";

export const DEFAULT_LOSS_PAGE_SIZE = 50;
const LOAD_MORE_STEP = 50;

type StoreOption = {
  id: string;
  name: string;
};

type LossDashboardKpis = {
  totals: { kg: number; und: number; formatted: string };
  topStoreByUnit: Record<"KG" | "UND", { storeName: string; total: number } | null>;
  topProductByUnit: Record<"KG" | "UND", { productName: string; total: number } | null>;
  totalRecords: number;
};

type LossFilters = {
  storeId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
};

function buildQuery(filters: LossFilters, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  if (filters.storeId) params.set("storeId", filters.storeId);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.search) params.set("search", filters.search);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function LossDashboardWorkspace({
  basePath,
  stores,
  losses,
  kpis,
  totalMatching,
  pageSize,
  filters,
}: {
  basePath: string;
  stores: StoreOption[];
  losses: StoreLossRecord[];
  kpis: LossDashboardKpis;
  totalMatching: number;
  pageSize: number;
  filters: LossFilters;
}) {
  const hasActiveFilters = Boolean(filters.storeId || filters.startDate || filters.endDate || filters.search);
  const hasMore = totalMatching > losses.length;
  const loadMoreHref = `${basePath}${buildQuery(filters, { limit: pageSize + LOAD_MORE_STEP })}`;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px" }}>
      {/* Título */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "#004737", margin: 0 }}>
          🗑️ Consulta de Perdas e Descarte FLV
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
          Acompanhamento consolidado de quebras, avarias e descartes registrados pelas lojas.
        </p>
      </div>

      {/* Barra de Filtros: formulário GET - os filtros são sempre resolvidos no
          servidor contra todo o período, nunca apenas sobre a página já carregada. */}
      <form
        method="get"
        action={basePath}
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 16,
          border: "1px solid #cbd5e1",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
        }}
      >
        <div style={{ minWidth: 180, flex: 1 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            LOJA:
          </label>
          <select
            name="storeId"
            defaultValue={filters.storeId ?? ""}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <option value="">Todas as Lojas ({stores.length})</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: 140 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            DATA INICIAL:
          </label>
          <input
            type="date"
            name="startDate"
            defaultValue={filters.startDate ?? ""}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
          />
        </div>

        <div style={{ minWidth: 140 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            DATA FINAL:
          </label>
          <input
            type="date"
            name="endDate"
            defaultValue={filters.endDate ?? ""}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
          />
        </div>

        <div style={{ minWidth: 200, flex: 1 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            BUSCA DE PRODUTO:
          </label>
          <input
            type="search"
            name="search"
            defaultValue={filters.search ?? ""}
            placeholder="Nome ou ERP..."
            style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
          />
        </div>

        <button
          type="submit"
          className="btn"
          style={{ fontSize: 12, padding: "8px 16px", minHeight: 36, borderRadius: 6, fontWeight: 700 }}
        >
          Filtrar
        </button>

        {hasActiveFilters && (
          <Link href={basePath} className="btn btn--secondary" style={{ fontSize: 12, padding: "8px 12px", minHeight: 36, borderRadius: 6, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Limpar Filtros
          </Link>
        )}
      </form>

      {/* Cards de KPIs, calculados sobre todo o período filtrado (não apenas a página exibida) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div style={{ background: "#ffffff", borderRadius: 10, padding: 16, border: "1px solid #e2e8f0", borderLeft: "5px solid #006b4f", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TOTAL DE PERDAS NO PERÍODO</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#991b1b", marginTop: 4 }}>{kpis.totals.formatted}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{kpis.totalRecords} lançamentos registrados</div>
        </div>

        {(["KG", "UND"] as const).map((unit) => (
          <div key={`store-${unit}`} style={{ background: "#ffffff", borderRadius: 10, padding: 16, border: "1px solid #e2e8f0", borderLeft: "5px solid #0284c7", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>LOJA COM MAIOR VOLUME ({unit})</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
              {kpis.topStoreByUnit[unit]?.storeName ?? "—"}
            </div>
            <div style={{ fontSize: 11, color: "#0284c7", marginTop: 2, fontWeight: 700 }}>
              {kpis.topStoreByUnit[unit] ? `${kpis.topStoreByUnit[unit]!.total.toFixed(2)} ${unit} acumulados` : "Sem registros"}
            </div>
          </div>
        ))}

        {(["KG", "UND"] as const).map((unit) => (
          <div key={`product-${unit}`} style={{ background: "#ffffff", borderRadius: 10, padding: 16, border: "1px solid #e2e8f0", borderLeft: "5px solid #f59e0b", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>PRODUTO COM MAIS DESCARTE ({unit})</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
              {kpis.topProductByUnit[unit]?.productName ?? "—"}
            </div>
            <div style={{ fontSize: 11, color: "#d97706", marginTop: 2, fontWeight: 700 }}>
              {kpis.topProductByUnit[unit] ? `${kpis.topProductByUnit[unit]!.total.toFixed(2)} ${unit} acumulados` : "Sem registros"}
            </div>
          </div>
        ))}
      </div>

      {/* Tabela Analítica de Lançamentos (página atual) */}
      <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #cbd5e1", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>DATA / HORA</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>LOJA</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>PRODUTO</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>QUANTIDADE</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>MOTIVO</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>OBSERVAÇÃO</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>RESPONSÁVEL</th>
              </tr>
            </thead>
            <tbody>
              {losses.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                    Nenhum registro de perda encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                losses.map((loss) => (
                  <tr key={loss.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#334155" }}>
                      {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(loss.recordedAt))}
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>{loss.storeName}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <ProductPhoto productId={loss.productId} name={loss.productName} photoKey={loss.photoKey} photoUpdatedAt={loss.photoUpdatedAt} size="sm" />
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>[{loss.erpCode}]</span>{" "}
                          <span style={{ fontWeight: 700, color: "#0f172a" }}>{loss.productName}</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: "#991b1b", whiteSpace: "nowrap" }}>
                      - {Number(loss.quantity).toFixed(2)} {loss.unit}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#fee2e2", color: "#991b1b", whiteSpace: "nowrap" }}>
                        {loss.reason}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12, maxWidth: 200 }}>{loss.notes || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#334155", whiteSpace: "nowrap" }}>{loss.recordedByName || "Operador"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {(losses.length > 0 || hasMore) && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Exibindo {losses.length} de {totalMatching} lançamento(s) no período filtrado.
            </span>
            {hasMore && (
              <Link href={loadMoreHref} className="btn btn--secondary" style={{ fontSize: 12, padding: "6px 14px", minHeight: 32, borderRadius: 6, textDecoration: "none" }}>
                Carregar mais
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
