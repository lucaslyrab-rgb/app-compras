/**
 * Seção "Embalados" (v1.4).
 *
 * Nas listas operacionais (Pedido, Consolidado, Custos, Destinação, Conferência,
 * Perdas e Fechamento), os produtos marcados como embalados no cadastro vêm
 * depois de todos os outros, numa seção com título. Cadastro de Produtos e
 * Precificação continuam em ordem alfabética simples.
 */

export const PACKAGED_SECTION_LABEL = "Embalados";

type Sortable = { name: string; isPackaged?: boolean | null; erpCode?: number | null };

/** Demais produtos primeiro, embalados por último; dentro de cada grupo, A–Z. */
export function compareForOperationalLists(a: Sortable, b: Sortable): number {
  const packaged = Number(Boolean(a.isPackaged)) - Number(Boolean(b.isPackaged));
  if (packaged !== 0) return packaged;
  return (
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) ||
    (a.erpCode ?? 0) - (b.erpCode ?? 0)
  );
}

export function sortForOperationalLists<T extends Sortable>(items: readonly T[]): T[] {
  return [...items].sort(compareForOperationalLists);
}

/** Verdadeiro no primeiro embalado de uma lista já ordenada: onde entra o título da seção. */
export function startsPackagedSection<T extends { isPackaged?: boolean | null }>(
  items: readonly T[],
  index: number,
): boolean {
  return Boolean(items[index]?.isPackaged) && !items[index - 1]?.isPackaged;
}
