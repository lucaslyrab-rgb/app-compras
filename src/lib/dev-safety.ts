/**
 * Trava dos scripts do ambiente local: só aceitam banco no próprio computador.
 * Evita que `dev:setup` ou `dev:restore` apaguem ou alterem a produção por um
 * `.env` copiado errado.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

export function assertLocalDatabaseUrl(databaseUrl: string | undefined): URL {
  if (!databaseUrl) throw new Error("DATABASE_URL não definido. Copie .env.development.example para .env.");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL inválido.");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Recusado: este script só roda no banco local (localhost). DATABASE_URL aponta para "${url.hostname}".`,
    );
  }
  return url;
}

/** Nome do banco a partir da URL ("postgres://u:p@localhost:5433/app_compras" → "app_compras"). */
export function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Nome do banco inválido na DATABASE_URL.");
  return name;
}
