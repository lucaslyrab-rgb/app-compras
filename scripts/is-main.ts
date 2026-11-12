import { pathToFileURL } from "node:url";

/**
 * Verdadeiro quando o arquivo foi chamado direto pelo terminal (`tsx scripts/x.ts`).
 * Funciona também no Windows, onde o caminho tem "C:\" e barras invertidas.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  return moduleUrl === pathToFileURL(argv1).href;
}
