"use client";

import { useMemo, useState } from "react";
import { ProductPhoto } from "@/components/product-photo";
import {
  calculateLossDashboardKpis,
  type StoreLossRecord,
} from "./domain";

type StoreOption = {
  id: string;
  name: string;
};

export function LossDashboardWorkspace({
  stores,
  initialLosses,
  initialFilters,
}: {
  stores: StoreOption[];
  initialLosses: StoreLossRecord[];
  initialFilters: {
    storeId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  };
}) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>(initialFilters.storeId ?? "");
  const [startDate, setStartDate] = useState<string>(initialFilters.startDate ?? "");
  const [endDate, setEndDate] = useState<string>(initialFilters.endDate ?? "");
  const [search, setSearch] = useState<string>(initialFilters.search ?? "");

  // Filtro interativo no cliente sobre os registros carregados
  const filteredLosses = useMemo(() => {
    return initialLosses.filter((l) => {
      if (selectedStoreId && l.storeId !== selectedStoreId) return false;

      const dateStr = l.recordedAt.slice(0, 10);
      if (startDate && dateStr < startDate) return false;
      if (endDate && dateStr > endDate) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchName = l.productName.toLowerCase().includes(q);
        const matchErp = String(l.erpCode).includes(q);
        if (!matchName && !matchErp) return false;
      }

      return true;
    });
  }, [initialLosses, selectedStoreId, startDate, endDate, search]);

  const kpis = useMemo(() => {
    return calculateLossDashboardKpis(filteredLosses);
  }, [filteredLosses]);

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

      {/* Barra de Filtros */}
      <div
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
            value={selectedStoreId}
            onChange={(e) => setSelectedStoreId(e.target.value)}
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
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
            }}
          />
        </div>

        <div style={{ minWidth: 140 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            DATA FINAL:
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
            }}
          />
        </div>

        <div style={{ minWidth: 200, flex: 1 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            BUSCA DE PRODUTO:
          </label>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome ou ERP..."
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 13,
            }}
          />
        </div>

        {(selectedStoreId || startDate || endDate || search) && (
          <button
            type="button"
            onClick={() => {
              setSelectedStoreId("");
              setStartDate("");
              setEndDate("");
              setSearch("");
            }}
            className="btn btn--secondary"
            style={{ fontSize: 12, padding: "8px 12px", minHeight: 36, borderRadius: 6 }}
          >
            Limpar Filtros
          </button>
        )}
      </div>

      {/* Cards de KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            background: "#ffffff",
            borderRadius: 10,
            padding: 16,
            border: "1px solid #e2e8f0",
            borderLeft: "5px solid #006b4f",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>TOTAL DE PERDAS NO PERÍODO</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#991b1b", marginTop: 4 }}>
            {kpis.totals.formatted}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {kpis.totalRecords} lançamentos registrados
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 10,
            padding: 16,
            border: "1px solid #e2e8f0",
            borderLeft: "5px solid #0284c7",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>LOJA COM MAIOR VOLUME</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
            {kpis.topStore?.storeName ?? "—"}
          </div>
          <div style={{ fontSize: 11, color: "#0284c7", marginTop: 2, fontWeight: 700 }}>
            {kpis.topStore ? `${kpis.topStore.totalKg.toFixed(2)} acumulados` : "Sem registros"}
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: 10,
            padding: 16,
            border: "1px solid #e2e8f0",
            borderLeft: "5px solid #f59e0b",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>PRODUTO COM MAIS DESCARTE</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
            {kpis.topProduct?.productName ?? "—"}
          </div>
          <div style={{ fontSize: 11, color: "#d97706", marginTop: 2, fontWeight: 700 }}>
            {kpis.topProduct ? `${kpis.topProduct.totalKg.toFixed(2)} acumulados` : "Sem registros"}
          </div>
        </div>
      </div>

      {/* Tabela Analítica de Lançamentos */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          border: "1px solid #cbd5e1",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>DATA / HORA</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>LOJA</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>PRODUTO</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569", textAlign: "right" }}>
                  QUANTIDADE
                </th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>MOTIVO</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>OBSERVAÇÃO</th>
                <th style={{ padding: "12px 14px", fontWeight: 700, color: "#475569" }}>RESPONSÁVEL</th>
              </tr>
            </thead>
            <tbody>
              {filteredLosses.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
                    Nenhum registro de perda encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredLosses.map((loss) => (
                  <tr key={loss.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "#334155" }}>
                      {new Intl.DateTimeFormat("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(loss.recordedAt))}
                    </td>

                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
                      {loss.storeName}
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <ProductPhoto
                          productId={loss.productId}
                          name={loss.productName}
                          photoKey={loss.photoKey}
                          photoUpdatedAt={loss.photoUpdatedAt}
                          size="sm"
                        />
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>
                            [{loss.erpCode}]
                          </span>{" "}
                          <span style={{ fontWeight: 700, color: "#0f172a" }}>{loss.productName}</span>
                        </div>
                      </div>
                    </td>

                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 800, color: "#991b1b", whiteSpace: "nowrap" }}>
                      - {Number(loss.quantity).toFixed(2)} {loss.unit}
                    </td>

                    <td style={{ padding: "10px 14px" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#fee2e2",
                          color: "#991b1b",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {loss.reason}
                      </span>
                    </td>

                    <td style={{ padding: "10px 14px", color: "#64748b", fontSize: 12, maxWidth: 200 }}>
                      {loss.notes || "—"}
                    </td>

                    <td style={{ padding: "10px 14px", color: "#334155", whiteSpace: "nowrap" }}>
                      {loss.recordedByName || "Operador"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
