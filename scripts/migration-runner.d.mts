export type RunMigrationsOptions = {
  databaseUrl: string;
  migrationsDirectory?: string;
  onApplied?: (filename: string) => unknown;
};

export const BASELINE_REQUIRED_TABLES: string[];
export function computeChecksum(content: string): string;
export function discoverMigrations(migrationsDirectory?: string): Promise<string[]>;
export function runMigrations(options: RunMigrationsOptions): Promise<string[]>;
