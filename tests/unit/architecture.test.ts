import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat();
}

describe("fronteiras dos módulos", () => {
  it("não permite importação entre repositórios de domínio", async () => {
    const moduleFiles = (await files("src/modules")).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    for (const file of moduleFiles) {
      const source = await readFile(file, "utf8");
      const moduleName = file.split(path.sep)[2];
      const imports = [...source.matchAll(/from ["']@\/modules\/([^/"']+)/g)].map((match) => match[1]);
      if (path.basename(file) === "repository.ts") expect(imports.filter((name) => name !== moduleName && name !== "identity")).toEqual([]);
    }
  });
});
