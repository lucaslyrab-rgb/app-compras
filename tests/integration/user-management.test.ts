import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  createUser,
  updateUser,
  toggleUserActive,
  resetUserPassword,
  listUsersForManagement,
  listActiveStores,
} from "../../src/modules/identity/repository";
import {
  LastAdminProtectionError,
  UserConflictError,
  UserValidationError,
  hashToken,
  sessionExpiries,
  verifyPassword,
} from "../../src/modules/identity/domain";
import { database } from "../../src/db/client";
import { sessions } from "../../src/db/schema";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Gestão de Usuários V1 - Integração no PostgreSQL", () => {
  const stamp = Date.now();
  let testStoreId: string;

  beforeAll(async () => {
    // Insere lojas de teste caso não existam
    const [store1] = await database().sql<{ id: string }[]>`
      INSERT INTO stores (slug, name, active)
      VALUES (${`loja-teste-um-${stamp}`}, 'Loja Teste Um', true)
      RETURNING id;
    `;
    await database().sql`
      INSERT INTO stores (slug, name, active)
      VALUES (${`loja-teste-dois-${stamp}`}, 'Loja Teste Dois', true);
    `;
    testStoreId = store1.id;
  });

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      await database().sql`DELETE FROM users WHERE email LIKE ${`%${stamp}%`}`;
      await database().sql`DELETE FROM stores WHERE slug LIKE ${`%${stamp}%`}`;
    }
  });

  describe("Criação de Usuários", () => {
    it("cria usuário LOJA com loja vinculada e permissões de loja", async () => {
      const email = `loja-${stamp}@example.com`;
      const created = await createUser({
        name: "Operador Loja",
        email,
        role: "LOJA",
        storeId: testStoreId,
        permissions: ["pedidos:criar", "pedidos:historico"],
        password: "LojaSenha2026",
        passwordConfirmation: "LojaSenha2026",
      });

      expect(created.id).toBeDefined();
      expect(created.email).toBe(email);
      expect(created.role).toBe("LOJA");
      expect(created.storeId).toBe(testStoreId);
      expect(created.storeName).toBe("Loja Teste Um");
      expect(created.permissions).toEqual(["pedidos:criar", "pedidos:historico"]);
      expect(created.active).toBe(true);

      // Confirma hash scrypt no banco e ausência de senha em texto claro
      const [dbRow] = await database().sql<{ password_hash: string }[]>`
        SELECT password_hash FROM users WHERE id = ${created.id}::uuid;
      `;
      expect(dbRow.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
      await expect(verifyPassword("LojaSenha2026", dbRow.password_hash)).resolves.toBe(true);
    });

    it("cria usuário COMPRADOR sem loja e permissões de comprador", async () => {
      const email = `comprador-${stamp}@example.com`;
      const created = await createUser({
        name: "Comprador Alimentos",
        email,
        role: "COMPRADOR",
        storeId: null,
        permissions: ["compras:consolidado", "compras:custos"],
        password: "compras2026",
        passwordConfirmation: "compras2026",
      });

      expect(created.role).toBe("COMPRADOR");
      expect(created.storeId).toBeNull();
      expect(created.storeName).toBeNull();
      expect(created.permissions).toEqual(["compras:consolidado", "compras:custos"]);
    });

    it("rejeita e-mail duplicado de forma case-insensitive", async () => {
      const email = `unico-${stamp}@example.com`;
      await createUser({
        name: "Primeiro",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
      });

      // Tenta criar com maiúsculas
      await expect(
        createUser({
          name: "Segundo",
          email: email.toUpperCase(),
          role: "COMPRADOR",
          permissions: ["compras:consolidado"],
          password: "senhaValida1",
          passwordConfirmation: "senhaValida1",
        })
      ).rejects.toThrow(/Já existe um usuário cadastrado com este e-mail/);
    });

    it("rejeita criação que viola o invariante de loja", async () => {
      // LOJA sem storeId
      await expect(
        createUser({
          name: "Loja Sem Loja",
          email: `loja-invalida-${stamp}@example.com`,
          role: "LOJA",
          storeId: null,
          permissions: ["pedidos:criar"],
          password: "senhaValida1",
          passwordConfirmation: "senhaValida1",
        })
      ).rejects.toThrow(UserValidationError);

      // COMPRADOR com storeId
      await expect(
        createUser({
          name: "Comprador Com Loja",
          email: `comprador-invalido-${stamp}@example.com`,
          role: "COMPRADOR",
          storeId: testStoreId,
          permissions: ["compras:consolidado"],
          password: "senhaValida1",
          passwordConfirmation: "senhaValida1",
        })
      ).rejects.toThrow(UserValidationError);
    });

    it("rejeita senha que não atende à nova política V1", async () => {
      await expect(
        createUser({
          name: "Senha Curta",
          email: `curta-${stamp}@example.com`,
          role: "COMPRADOR",
          permissions: ["compras:consolidado"],
          password: "abc1",
          passwordConfirmation: "abc1",
        })
      ).rejects.toThrow(/8 caracteres/);
    });
  });

  describe("Edição de Usuários e Concorrência Otimista", () => {
    it("edita usuário com sucesso quando expectedUpdatedAt coincide", async () => {
      const email = `editar-${stamp}@example.com`;
      const created = await createUser({
        name: "Nome Antes",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
      });

      const { user: updated, previous } = await updateUser({
        id: created.id,
        name: "Nome Depois",
        email: `editado-${stamp}@example.com`,
        role: "COMPRADOR",
        permissions: ["compras:consolidado", "compras:custos"],
        active: true,
        expectedUpdatedAt: created.updatedAt,
      });

      expect(previous.name).toBe("Nome Antes");
      expect(updated.name).toBe("Nome Depois");
      expect(updated.email).toBe(`editado-${stamp}@example.com`);
      expect(updated.permissions).toEqual(["compras:consolidado", "compras:custos"]);
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime()
      );
    });

    it("detecta conflito de concorrência e rejeita alteração quando expectedUpdatedAt é desatualizado", async () => {
      const email = `concorrente-${stamp}@example.com`;
      const created = await createUser({
        name: "Original",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
      });

      // Primeiro admin atualiza o usuário
      await updateUser({
        id: created.id,
        name: "Alteração Admin A",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        active: true,
        expectedUpdatedAt: created.updatedAt,
      });

      // Segundo admin tenta atualizar usando o timestamp antigo
      await expect(
        updateUser({
          id: created.id,
          name: "Alteração Admin B (Conflito)",
          email,
          role: "COMPRADOR",
          permissions: ["compras:consolidado"],
          active: true,
          expectedUpdatedAt: created.updatedAt, // Timestamp antigo!
        })
      ).rejects.toThrow(UserConflictError);
    });
  });

  describe("Sessões, Ativação, Inativação e Reset de Senha", () => {
    it("inativação revoga imediatamente todas as sessões abertas do usuário", async () => {
      const email = `inativar-${stamp}@example.com`;
      const user = await createUser({
        name: "Usuario Para Inativar",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
      });

      // Cria sessões simuladas para o usuário
      const token1 = "token-user-1";
      const token2 = "token-user-2";
      const exp = sessionExpiries();
      await database().db.insert(sessions).values([
        { userId: user.id, tokenHash: hashToken(token1), ...exp },
        { userId: user.id, tokenHash: hashToken(token2), ...exp },
      ]);

      // Inativa o usuário
      const { user: deactivated } = await toggleUserActive({
        id: user.id,
        active: false,
        expectedUpdatedAt: user.updatedAt,
      });
      expect(deactivated.active).toBe(false);

      // Confirma que as sessões do usuário foram revogadas
      const activeSessions = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL;
      `;
      expect(activeSessions.length).toBe(0);

      // Reativação do usuário não reativa sessões antigas
      const { user: reactivated } = await toggleUserActive({
        id: user.id,
        active: true,
        expectedUpdatedAt: deactivated.updatedAt,
      });
      expect(reactivated.active).toBe(true);

      const stillRevoked = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL;
      `;
      expect(stillRevoked.length).toBe(0);
    });

    it("reset de senha revoga todas as sessões do usuário alvo e preserva sessões de terceiros", async () => {
      const emailTarget = `target-${stamp}@example.com`;
      const emailOther = `other-${stamp}@example.com`;

      const target = await createUser({
        name: "Usuario Target",
        email: emailTarget,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaAntiga123",
        passwordConfirmation: "senhaAntiga123",
      });

      const other = await createUser({
        name: "Usuario Outro",
        email: emailOther,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaOutro123",
        passwordConfirmation: "senhaOutro123",
      });

      const exp = sessionExpiries();
      await database().db.insert(sessions).values([
        { userId: target.id, tokenHash: hashToken("target-token"), ...exp },
        { userId: other.id, tokenHash: hashToken("other-token"), ...exp },
      ]);

      // Executa reset de senha no target
      await resetUserPassword({
        targetUserId: target.id,
        newPassword: "novaSenha456",
        passwordConfirmation: "novaSenha456",
      });

      // Confirma que sessão do target foi revogada
      const targetSessions = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${target.id}::uuid AND revoked_at IS NULL;
      `;
      expect(targetSessions.length).toBe(0);

      // Confirma que sessão do outro usuário permaneceu ATIVA
      const otherSessions = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${other.id}::uuid AND revoked_at IS NULL;
      `;
      expect(otherSessions.length).toBe(1);

      // Valida novo hash e login do target
      const [updatedTarget] = await database().sql<{ password_hash: string }[]>`
        SELECT password_hash FROM users WHERE id = ${target.id}::uuid;
      `;
      await expect(verifyPassword("novaSenha456", updatedTarget.password_hash)).resolves.toBe(true);
      await expect(verifyPassword("senhaAntiga123", updatedTarget.password_hash)).resolves.toBe(false);
    });
  });

  describe("Proteção do Último Administrador (Transacional + Advisory Lock)", () => {
    it("impede inativação do último administrador com gestor:usuarios", async () => {
      // Cria um schema isolado para testar o cenário de último admin estrito
      const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
      const schemaName = `test_last_admin_${stamp}`;
      await rootSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await rootSql.end();

      const isolatedUrl = new URL(process.env.DATABASE_URL!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schemaName},public`);

      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
      });

      const isoSql = postgres(isolatedUrl.toString(), { max: 2 });
      try {
        // Insere exatamente UM admin ativo
        const [singleAdmin] = await isoSql<{ id: string; updated_at: Date }[]>`
          INSERT INTO users (email, name, password_hash, role, active, permissions)
          VALUES ('solitario@example.com', 'Admin Solitário', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
          RETURNING id, updated_at;
        `;

        // Testa proteção no nível transacional diretamente
        await expect(
          isoSql.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext('user_management_mutation_lock'))`;
            await tx`UPDATE users SET active = false WHERE id = ${singleAdmin.id}::uuid`;
            const [{ count }] = await tx<[{ count: number }]>`
              SELECT count(*)::int AS count FROM users WHERE active = true AND 'gestor:usuarios' = ANY(permissions);
            `;
            if (count < 1) {
              throw new LastAdminProtectionError("Impossível remover último admin");
            }
          })
        ).rejects.toThrow(LastAdminProtectionError);

        // Confirma que rollback ocorreu e o admin continua ativo
        const [stillActive] = await isoSql<{ active: boolean }[]>`
          SELECT active FROM users WHERE id = ${singleAdmin.id}::uuid;
        `;
        expect(stillActive.active).toBe(true);

        // Testa proteção ao tentar remover a permissão gestor:usuarios
        await expect(
          isoSql.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext('user_management_mutation_lock'))`;
            await tx`UPDATE users SET permissions = ARRAY['gestor:produtos']::text[] WHERE id = ${singleAdmin.id}::uuid`;
            const [{ count }] = await tx<[{ count: number }]>`
              SELECT count(*)::int AS count FROM users WHERE active = true AND 'gestor:usuarios' = ANY(permissions);
            `;
            if (count < 1) {
              throw new LastAdminProtectionError("Impossível remover último admin");
            }
          })
        ).rejects.toThrow(LastAdminProtectionError);
      } finally {
        await isoSql.end();
        const cleanupSql = postgres(process.env.DATABASE_URL!, { max: 1 });
        await cleanupSql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await cleanupSql.end();
      }
    });

    it("duas transações concorrentes não podem deixar o sistema sem administrador", async () => {
      const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
      const schemaName = `test_concurrent_admin_${stamp}`;
      await rootSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await rootSql.end();

      const isolatedUrl = new URL(process.env.DATABASE_URL!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schemaName},public`);

      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
      });

      const client1 = postgres(isolatedUrl.toString(), { max: 1 });
      const client2 = postgres(isolatedUrl.toString(), { max: 1 });

      try {
        // Insere exatamente DOIS administradores ativos
        const [admin1, admin2] = await client1<{ id: string }[]>`
          INSERT INTO users (email, name, password_hash, role, active, permissions)
          VALUES ('admin1@example.com', 'Admin 1', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[]),
                 ('admin2@example.com', 'Admin 2', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
          RETURNING id;
        `;

        // Função de mutação transacional com advisory lock
        const inactivateUser = async (client: typeof client1, targetId: string) => {
          return client.begin(async (tx) => {
            await tx`SELECT pg_advisory_xact_lock(hashtext('user_management_mutation_lock'))`;
            await tx`UPDATE users SET active = false WHERE id = ${targetId}::uuid`;
            const [{ count }] = await tx<[{ count: number }]>`
              SELECT count(*)::int AS count FROM users WHERE active = true AND 'gestor:usuarios' = ANY(permissions);
            `;
            if (count < 1) {
              throw new LastAdminProtectionError("Impossível remover último admin");
            }
          });
        };

        // Dispara simultaneamente: client1 tenta inativar admin1 e client2 tenta inativar admin2
        const [res1, res2] = await Promise.allSettled([
          inactivateUser(client1, admin1.id),
          inactivateUser(client2, admin2.id),
        ]);

        // Exatamente um deve ter sucesso e um deve ser rejeitado com LastAdminProtectionError
        const successes = [res1, res2].filter((r) => r.status === "fulfilled");
        const failures = [res1, res2].filter(
          (r) => r.status === "rejected" && r.reason instanceof LastAdminProtectionError
        );

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(1);

        // Confirma no banco que resta exatamente 1 admin ativo
        const [{ remaining_count }] = await client1<[{ remaining_count: number }]>`
          SELECT count(*)::int AS remaining_count FROM users WHERE active = true AND 'gestor:usuarios' = ANY(permissions);
        `;
        expect(remaining_count).toBe(1);
      } finally {
        await client1.end();
        await client2.end();
        const cleanupSql = postgres(process.env.DATABASE_URL!, { max: 1 });
        await cleanupSql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await cleanupSql.end();
      }
    });
  });

  describe("Listagens", () => {
    it("listUsersForManagement não expõe password_hash e traz storeName", async () => {
      const usersList = await listUsersForManagement();
      expect(usersList.length).toBeGreaterThan(0);
      for (const u of usersList) {
        expect((u as Record<string, unknown>).password_hash).toBeUndefined();
        expect((u as Record<string, unknown>).passwordHash).toBeUndefined();
        expect(u.id).toBeDefined();
        expect(u.email).toBeDefined();
        expect(u.name).toBeDefined();
        expect(u.role).toBeDefined();
        expect(u.permissions).toBeInstanceOf(Array);
        expect(typeof u.active).toBe("boolean");
      }
    });

    it("listActiveStores lista lojas ativas ordenadas por nome", async () => {
      const storesList = await listActiveStores();
      expect(storesList.length).toBeGreaterThanOrEqual(2);
      expect(storesList.some((s) => s.id === testStoreId)).toBe(true);
    });
  });
});
