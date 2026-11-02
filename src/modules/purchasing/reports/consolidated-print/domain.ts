import { shortStoreName, type ConsolidatedData } from "../../domain";

export type PrintRow = {
  id: string;
  name: string;
  /** Pedido por loja, na ordem de `stores`; null = sem pedido (impresso como "–"). */
  quantities: (number | null)[];
  total: number;
  unit: string;
};

export type PrintStoreColumn = { id: string; initials: string; name: string; sent: boolean };

export type ConsolidatedPrintModel = {
  cycleDate: string;
  stores: PrintStoreColumn[];
  columns: [PrintRow[], PrintRow[]];
  productsWithOrder: number;
  totalProducts: number;
  /** Densidade da fonte para caber em uma folha A4. */
  density: "normal" | "compact";
};

/** Sigla da loja (Ponta da Fruta → PF, Balneário → BA, Santa Mônica → SM). */
export function storeInitials(name: string): string {
  const short = shortStoreName(name);
  const words = short.split(/\s+/).filter((word) => !/^(da|de|do|das|dos|e)$/i.test(word));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return short.slice(0, 2).toUpperCase();
}

/** Linhas por coluna acima das quais a fonte fica compacta para caber em uma folha. */
export const COMPACT_ROWS_PER_COLUMN = 40;

/**
 * Monta o relatório A4 do Consolidado: TODOS os produtos (como a folha de compra
 * em papel), em ordem alfabética, divididos em duas colunas. Quantidade zero ou
 * produto não informado vira "–", deixando espaço para anotar oportunidades.
 */
export function buildConsolidatedPrintModel(data: ConsolidatedData): ConsolidatedPrintModel {
  const rows: PrintRow[] = [...data.products]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((product) => {
      const quantities = data.stores.map((store) => {
        const value = product.stores[store.id];
        const quantity = value ? Number(value.quantity) : 0;
        return quantity > 0 ? quantity : null;
      });
      return {
        id: product.id,
        name: product.name,
        quantities,
        total: Number(product.total),
        unit: product.purchaseFormat,
      };
    });

  const half = Math.ceil(rows.length / 2);
  return {
    cycleDate: data.cycleDate,
    stores: data.stores.map((store) => ({
      id: store.id,
      initials: storeInitials(store.name),
      name: shortStoreName(store.name),
      sent: Boolean(store.order),
    })),
    columns: [rows.slice(0, half), rows.slice(half)],
    productsWithOrder: rows.filter((row) => row.total > 0).length,
    totalProducts: rows.length,
    density: half > COMPACT_ROWS_PER_COLUMN ? "compact" : "normal",
  };
}
