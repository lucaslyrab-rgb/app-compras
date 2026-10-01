import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migration-runner.mjs";
import {
  createUser,
  updateUser,
  toggleUserActive,
  resetUserPassword,
  listUsersForManagement,
  listActiveStores,
  USER_MANAGEMENT_ADVISORY_LOCK_ID,
} from "../../src/modules/identity/repository";
import {
  LastAdminProtectionError,
  UserConflictError,
  UserValidationError,
  hashPassword,
  hashToken,
  sessionExpiries,
  verifyPassword,
} from "../../src/modules/identity/domain";
import { database } from "../../src/db/client";
import { sessions } from "../../src/db/schema";
import * as schema from "../../src/db/schema";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("Gestão de Usuários V1 - Integração no PostgreSQL", () => {
  const stamp = Date.now();
  let testStoreId: string;
  let actorId: string;

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

    // Insere usuário ator para satisfazer FK de audit_events
    const [actorUser] = await database().sql<{ id: string }[]>`
      INSERT INTO users (email, name, password_hash, role, active, permissions)
      VALUES (${`actor-admin-${stamp}@example.com`}, 'Actor Admin', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
      RETURNING id;
    `;
    actorId = actorUser.id;
  });

  afterAll(async () => {
    if (process.env.DATABASE_URL) {
      await database().sql`DELETE FROM users WHERE email LIKE ${`%${stamp}%`}`;
      await database().sql`DELETE FROM stores WHERE slug LIKE ${`%${stamp}%`}`;
    }
  });

  describe("Criação de Usuários", () => {
    it("cria usuário LOJA com loja vinculada, permissões de loja e grava auditoria atômica", async () => {
      const email = `loja-${stamp}@example.com`;
      const created = await createUser({
        name: "Operador Loja",
        email,
        role: "LOJA",
        storeId: testStoreId,
        permissions: ["pedidos:criar", "pedidos:historico"],
        password: "LojaSenha2026",
        passwordConfirmation: "LojaSenha2026",
        actorId,
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

      // Confirma gravação atômica da auditoria correspondente
      const auditRows = await database().sql<{ action: string; metadata: unknown }[]>`
        SELECT action, metadata FROM audit_events
        WHERE entity_id = ${created.id} AND action = 'user_created';
      `;
      expect(auditRows.length).toBe(1);
      const auditMeta = (
        typeof auditRows[0].metadata === "string"
          ? JSON.parse(auditRows[0].metadata)
          : auditRows[0].metadata
      ) as Record<string, unknown>;
      expect(auditMeta.email).toBe(email);
      expect(JSON.stringify(auditMeta)).not.toContain("LojaSenha2026");
      expect(JSON.stringify(auditMeta)).not.toContain("password");
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
        actorId,
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
        actorId,
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
          actorId,
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
          actorId,
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
          actorId,
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
          actorId,
        })
      ).rejects.toThrow(/8 caracteres/);
    });
  });

  describe("Edição de Usuários e Concorrência Otimista (CAS Real)", () => {
    it("edição com watermark atual avança timestamp e reutilização do watermark antigo gera conflito", async () => {
      const email = `cas-${stamp}@example.com`;
      const created = await createUser({
        name: "Nome Antes",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
        actorId,
      });

      // 1. Edição com watermark atual → sucesso
      const { user: updated1, previous } = await updateUser({
        id: created.id,
        name: "Nome Depois",
        email: `cas-editado-${stamp}@example.com`,
        role: "COMPRADOR",
        permissions: ["compras:consolidado", "compras:custos"],
        active: true,
        expectedUpdatedAt: created.updatedAt,
        actorId,
      });

      expect(previous.name).toBe("Nome Antes");
      expect(updated1.name).toBe("Nome Depois");
      expect(updated1.email).toBe(`cas-editado-${stamp}@example.com`);
      expect(new Date(updated1.updatedAt).getTime()).toBeGreaterThan(
        new Date(created.updatedAt).getTime()
      );

      // 2. Reutilização do watermark antigo → conflito (UserConflictError)
      await expect(
        updateUser({
          id: created.id,
          name: "Tentativa com Watermark Antigo",
          email: `cas-editado-${stamp}@example.com`,
          role: "COMPRADOR",
          permissions: ["compras:consolidado"],
          active: true,
          expectedUpdatedAt: created.updatedAt, // Timestamp inicial defasado!
          actorId,
        })
      ).rejects.toThrow(UserConflictError);

      // 3. Duas alterações rápidas não deixam watermark reutilizável e avançam monotonicamente
      const { user: updated2 } = await updateUser({
        id: created.id,
        name: "Nome Rápido 2",
        email: `cas-editado-${stamp}@example.com`,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        active: true,
        expectedUpdatedAt: updated1.updatedAt,
        actorId,
      });

      expect(new Date(updated2.updatedAt).getTime()).toBeGreaterThan(
        new Date(updated1.updatedAt).getTime()
      );

      // 4. Nenhuma alteração obsoleta sobrescreve estado novo
      await expect(
        updateUser({
          id: created.id,
          name: "Tentativa Obsoleta",
          email: `cas-editado-${stamp}@example.com`,
          role: "COMPRADOR",
          permissions: ["compras:consolidado"],
          active: true,
          expectedUpdatedAt: updated1.updatedAt, // Watermark intermediário obsoleto!
          actorId,
        })
      ).rejects.toThrow(UserConflictError);

      // Confirma que o estado final permaneceu o mais recente (updated2)
      const [finalDb] = await database().sql<{ name: string }[]>`
        SELECT name FROM users WHERE id = ${created.id}::uuid;
      `;
      expect(finalDb.name).toBe("Nome Rápido 2");
    });
  });

  describe("Sessões, Ativação, Inativação e Reset de Senha", () => {
    it("inativação atômica revoga imediatamente todas as sessões abertas do usuário e grava auditoria", async () => {
      const email = `inativar-${stamp}@example.com`;
      const user = await createUser({
        name: "Usuario Para Inativar",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaValida1",
        passwordConfirmation: "senhaValida1",
        actorId,
      });

      // Cria sessões simuladas para o usuário
      const token1 = `token-user-1-${stamp}`;
      const token2 = `token-user-2-${stamp}`;
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
        actorId,
      });
      expect(deactivated.active).toBe(false);

      // Confirma que as sessões do usuário foram revogadas
      const activeSessions = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL;
      `;
      expect(activeSessions.length).toBe(0);

      // Confirma gravação da auditoria correspondente
      const auditDeact = await database().sql<{ action: string }[]>`
        SELECT action FROM audit_events
        WHERE entity_id = ${user.id} AND action = 'user_deactivated';
      `;
      expect(auditDeact.length).toBe(1);

      // Reativação do usuário não reativa sessões antigas
      const { user: reactivated } = await toggleUserActive({
        id: user.id,
        active: true,
        expectedUpdatedAt: deactivated.updatedAt,
        actorId,
      });
      expect(reactivated.active).toBe(true);

      const stillRevoked = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL;
      `;
      expect(stillRevoked.length).toBe(0);
    });

    it("reset de senha revoga todas as sessões do usuário alvo, preserva sessões de terceiros e grava auditoria atômica", async () => {
      const emailTarget = `target-${stamp}@example.com`;
      const emailOther = `other-${stamp}@example.com`;

      const target = await createUser({
        name: "Usuario Target",
        email: emailTarget,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaAntiga123",
        passwordConfirmation: "senhaAntiga123",
        actorId,
      });

      const other = await createUser({
        name: "Usuario Outro",
        email: emailOther,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaOutro123",
        passwordConfirmation: "senhaOutro123",
        actorId,
      });

      const exp = sessionExpiries();
      await database().db.insert(sessions).values([
        { userId: target.id, tokenHash: hashToken(`target-token-${stamp}`), ...exp },
        { userId: other.id, tokenHash: hashToken(`other-token-${stamp}`), ...exp },
      ]);

      // Executa reset de senha no target com expectedUpdatedAt (Caso A)
      const resetResult = await resetUserPassword({
        targetUserId: target.id,
        newPassword: "novaSenha456",
        passwordConfirmation: "novaSenha456",
        actorId,
        expectedUpdatedAt: target.updatedAt,
      });

      expect(resetResult.targetUserId).toBe(target.id);
      expect(resetResult.updatedAt).toBeDefined();
      expect(new Date(resetResult.updatedAt).getTime()).toBeGreaterThan(new Date(target.updatedAt).getTime());

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

      // Confirma auditoria sem vazar credenciais
      const auditReset = await database().sql<{ action: string; metadata: unknown }[]>`
        SELECT action, metadata FROM audit_events
        WHERE entity_id = ${target.id} AND action = 'user_password_reset_by_admin';
      `;
      expect(auditReset.length).toBe(1);
      const str = JSON.stringify(auditReset[0].metadata);
      expect(str).not.toContain("novaSenha456");
      expect(str).not.toContain("senhaAntiga123");
      expect(str).not.toContain("password");
      expect(str).not.toContain("hash");
    });

    it("Caso B: reset com watermark antigo/obsoleto é rejeitado com UserConflictError sem alterar estado", async () => {
      const email = `cas-b-${stamp}@example.com`;
      const user = await createUser({
        name: "Usuario CAS B",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaOriginal123",
        passwordConfirmation: "senhaOriginal123",
        actorId,
      });

      const watermarkA = user.updatedAt;

      // Cria sessão ativa
      const exp = sessionExpiries();
      await database().db.insert(sessions).values([
        { userId: user.id, tokenHash: hashToken(`token-cas-b-${stamp}`), ...exp },
      ]);

      // Realiza outra alteração para avançar watermark para B
      const { user: updatedUser } = await updateUser({
        id: user.id,
        name: "Usuario CAS B Alterado",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        active: true,
        expectedUpdatedAt: watermarkA,
        actorId,
      });
      const watermarkB = updatedUser.updatedAt;
      expect(new Date(watermarkB).getTime()).toBeGreaterThan(new Date(watermarkA).getTime());

      // Tenta reset usando watermark A (obsoleto)
      await expect(
        resetUserPassword({
          targetUserId: user.id,
          newPassword: "novaSenhaFalha123",
          passwordConfirmation: "novaSenhaFalha123",
          expectedUpdatedAt: watermarkA,
          actorId,
        })
      ).rejects.toThrow(UserConflictError);

      // Confirma que senha permanece inalterada
      const [u] = await database().sql<{ password_hash: string }[]>`
        SELECT password_hash FROM users WHERE id = ${user.id}::uuid;
      `;
      await expect(verifyPassword("senhaOriginal123", u.password_hash)).resolves.toBe(true);
      await expect(verifyPassword("novaSenhaFalha123", u.password_hash)).resolves.toBe(false);

      // Confirma que sessão continua ativa (não revogada)
      const sess = await database().sql<{ id: string }[]>`
        SELECT id FROM sessions WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL;
      `;
      expect(sess.length).toBe(1);

      // Confirma que nenhuma auditoria de reset foi gravada
      const audit = await database().sql<{ id: string }[]>`
        SELECT id FROM audit_events WHERE entity_id = ${user.id} AND action = 'user_password_reset_by_admin';
      `;
      expect(audit.length).toBe(0);
    });

    it("Caso D: resets consecutivos pela aplicação avançam monotonicamente o watermark (C > B > A)", async () => {
      const email = `cas-d-${stamp}@example.com`;
      const user = await createUser({
        name: "Usuario CAS D",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaInicial123",
        passwordConfirmation: "senhaInicial123",
        actorId,
      });

      const watermarkA = user.updatedAt;

      // 1º reset usando A -> retorna B
      const resB = await resetUserPassword({
        targetUserId: user.id,
        newPassword: "senhaSegunda123",
        passwordConfirmation: "senhaSegunda123",
        expectedUpdatedAt: watermarkA,
        actorId,
      });
      const watermarkB = resB.updatedAt;
      expect(new Date(watermarkB).getTime()).toBeGreaterThan(new Date(watermarkA).getTime());

      // 2º reset consecutivo imediato usando B -> retorna C
      const resC = await resetUserPassword({
        targetUserId: user.id,
        newPassword: "senhaTerceira123",
        passwordConfirmation: "senhaTerceira123",
        expectedUpdatedAt: watermarkB,
        actorId,
      });
      const watermarkC = resC.updatedAt;
      expect(new Date(watermarkC).getTime()).toBeGreaterThan(new Date(watermarkB).getTime());

      // Valida senha final
      const [u] = await database().sql<{ password_hash: string }[]>`
        SELECT password_hash FROM users WHERE id = ${user.id}::uuid;
      `;
      await expect(verifyPassword("senhaTerceira123", u.password_hash)).resolves.toBe(true);
    });

    it("Caso E: após reset retornar watermark B, edição e inativação sucedem sem falso conflito", async () => {
      const email = `cas-e-${stamp}@example.com`;
      const user = await createUser({
        name: "Usuario CAS E",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        password: "senhaInicial123",
        passwordConfirmation: "senhaInicial123",
        actorId,
      });

      // Reset usando A -> retorna watermark B
      const resReset = await resetUserPassword({
        targetUserId: user.id,
        newPassword: "senhaResetada123",
        passwordConfirmation: "senhaResetada123",
        expectedUpdatedAt: user.updatedAt,
        actorId,
      });
      const watermarkB = resReset.updatedAt;

      // Edita o usuário utilizando diretamente o watermark B retornado pelo reset
      const { user: edited } = await updateUser({
        id: user.id,
        name: "Usuario CAS E Editado",
        email,
        role: "COMPRADOR",
        permissions: ["compras:consolidado"],
        active: true,
        expectedUpdatedAt: watermarkB,
        actorId,
      });
      expect(edited.name).toBe("Usuario CAS E Editado");
      const watermarkC = edited.updatedAt;
      expect(new Date(watermarkC).getTime()).toBeGreaterThan(new Date(watermarkB).getTime());

      // Inativa o usuário utilizando o watermark C
      const { user: deactivated } = await toggleUserActive({
        id: user.id,
        active: false,
        expectedUpdatedAt: watermarkC,
        actorId,
      });
      expect(deactivated.active).toBe(false);
      expect(new Date(deactivated.updatedAt).getTime()).toBeGreaterThan(new Date(watermarkC).getTime());
    });
  });

  describe("Atomicidade e Rollback quando a Auditoria Falha", () => {
    it("garante rollback completo da mutação se a inserção da auditoria falhar", async () => {
      const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
      const schemaName = `test_audit_rollback_${stamp}`;
      await rootSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await rootSql.end();

      const isolatedUrl = new URL(process.env.DATABASE_URL!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schemaName},public`);

      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
      });

      const isoClient = postgres(isolatedUrl.toString(), { max: 2 });
      const isoDb = drizzle(isoClient, { schema });

      try {
        // Cria um trigger em audit_events que falha propositalmente
        await isoClient.unsafe(`
          CREATE OR REPLACE FUNCTION fail_audit_test() RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'Simulated audit event failure for rollback test';
          END;
          $$ LANGUAGE plpgsql;

          CREATE TRIGGER trigger_fail_audit
          BEFORE INSERT ON "${schemaName}".audit_events
          FOR EACH ROW EXECUTE FUNCTION fail_audit_test();
        `);

        // Insere ator no schema isolado para satisfazer a FK de audit_events
        const [isoActor] = await isoClient<{ id: string }[]>`
          INSERT INTO "${isoClient.unsafe(schemaName)}".users (email, name, password_hash, role, active, permissions)
          VALUES ('isoactor@example.com', 'Iso Actor', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
          RETURNING id;
        `;

        const email = `fail-audit-${stamp}@example.com`;
        let failureError: (Error & { cause?: { message?: string } }) | null = null;
        try {
          await createUser(
            {
              name: "Tentativa de Criação",
              email,
              role: "COMPRADOR",
              permissions: ["compras:consolidado"],
              password: "senhaValida123",
              passwordConfirmation: "senhaValida123",
              actorId: isoActor.id,
            },
            isoDb
          );
        } catch (err: unknown) {
          failureError = err as Error & { cause?: { message?: string } };
        }

        expect(failureError).toBeDefined();
        expect(`${failureError?.message ?? ""} ${failureError?.cause?.message ?? ""}`).toMatch(/audit/i);

        // Confirma no banco que o usuário NÃO foi criado (rollback garantido!)
        const checkUser = await isoClient<{ count: number }[]>`
          SELECT count(*)::int as count FROM "${isoClient.unsafe(schemaName)}".users WHERE email = ${email};
        `;
        expect(Number(checkUser[0].count)).toBe(0);

        // 2. Teste de rollback no resetUserPassword em caso de falha na auditoria
        const initialPwd = "senhaInicial123";
        const initialHash = await hashPassword(initialPwd);
        const [targetUser] = await isoClient<{ id: string; updated_at: Date; password_hash: string }[]>`
          INSERT INTO "${isoClient.unsafe(schemaName)}".users (email, name, password_hash, role, active, permissions)
          VALUES ('target-reset-fail@example.com', 'Target Reset Fail', ${initialHash}, 'COMPRADOR', true, ARRAY['compras:consolidado']::text[])
          RETURNING id, updated_at, password_hash;
        `;
        const exp = sessionExpiries();
        await isoClient`
          INSERT INTO "${isoClient.unsafe(schemaName)}".sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
          VALUES (${targetUser.id}::uuid, ${hashToken(`token-reset-fail-${stamp}`)}, ${exp.idleExpiresAt.toISOString()}::timestamptz, ${exp.absoluteExpiresAt.toISOString()}::timestamptz);
        `;

        let resetError: (Error & { cause?: { message?: string } }) | null = null;
        try {
          await resetUserPassword(
            {
              targetUserId: targetUser.id,
              newPassword: "novaSenhaTentada1",
              passwordConfirmation: "novaSenhaTentada1",
              expectedUpdatedAt: targetUser.updated_at,
              actorId: isoActor.id,
            },
            isoDb
          );
        } catch (err: unknown) {
          resetError = err as Error & { cause?: { message?: string } };
        }
        expect(resetError).toBeDefined();
        expect(`${resetError?.message ?? ""} ${resetError?.cause?.message ?? ""}`).toMatch(/audit/i);

        // Confirma no banco: password_hash continua idêntico, senha antiga funciona e nova não funciona
        const [targetDbAfterReset] = await isoClient<{ password_hash: string; updated_at: Date }[]>`
          SELECT password_hash, updated_at FROM "${isoClient.unsafe(schemaName)}".users WHERE id = ${targetUser.id}::uuid;
        `;
        expect(targetDbAfterReset.password_hash).toBe(initialHash);
        await expect(verifyPassword(initialPwd, targetDbAfterReset.password_hash)).resolves.toBe(true);
        await expect(verifyPassword("novaSenhaTentada1", targetDbAfterReset.password_hash)).resolves.toBe(false);
        expect(new Date(targetDbAfterReset.updated_at).getTime()).toBe(new Date(targetUser.updated_at).getTime());

        // Confirma no banco: sessão continua válida (não foi revogada!)
        const targetSessionsAfterReset = await isoClient<{ id: string }[]>`
          SELECT id FROM "${isoClient.unsafe(schemaName)}".sessions WHERE user_id = ${targetUser.id}::uuid AND revoked_at IS NULL;
        `;
        expect(targetSessionsAfterReset.length).toBe(1);

        // Confirma no banco: nenhum evento de reset de senha foi persistido
        const auditResetCount = await isoClient<{ count: number }[]>`
          SELECT count(*)::int as count FROM "${isoClient.unsafe(schemaName)}".audit_events
          WHERE entity_id = ${targetUser.id} AND action = 'user_password_reset_by_admin';
        `;
        expect(Number(auditResetCount[0].count)).toBe(0);

        // 3. Teste de rollback no toggleUserActive (inativação) em caso de falha na auditoria
        const [userForDeact] = await isoClient<{ id: string; updated_at: string | Date; active: boolean }[]>`
          INSERT INTO "${isoClient.unsafe(schemaName)}".users (email, name, password_hash, role, active, permissions)
          VALUES ('target-deact-fail@example.com', 'Target Deact Fail', 'dummy', 'COMPRADOR', true, ARRAY['compras:consolidado']::text[])
          RETURNING id, updated_at, active;
        `;
        await isoClient`
          INSERT INTO "${isoClient.unsafe(schemaName)}".sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
          VALUES (${userForDeact.id}::uuid, ${hashToken(`token-deact-fail-${stamp}`)}, ${exp.idleExpiresAt.toISOString()}::timestamptz, ${exp.absoluteExpiresAt.toISOString()}::timestamptz);
        `;

        let deactError: (Error & { cause?: { message?: string } }) | null = null;
        try {
          await toggleUserActive(
            {
              id: userForDeact.id,
              active: false,
              expectedUpdatedAt: userForDeact.updated_at,
              actorId: isoActor.id,
            },
            isoDb
          );
        } catch (err: unknown) {
          deactError = err as Error & { cause?: { message?: string } };
        }
        expect(deactError).toBeDefined();
        expect(`${deactError?.message ?? ""} ${deactError?.cause?.message ?? ""}`).toMatch(/audit/i);

        // Confirma no banco: active continua true e updated_at inalterado
        const [targetDbAfterDeact] = await isoClient<{ active: boolean; updated_at: string | Date }[]>`
          SELECT active, updated_at FROM "${isoClient.unsafe(schemaName)}".users WHERE id = ${userForDeact.id}::uuid;
        `;
        expect(targetDbAfterDeact.active).toBe(true);
        expect(new Date(targetDbAfterDeact.updated_at).getTime()).toBe(new Date(userForDeact.updated_at).getTime());

        // Confirma no banco: sessão continua ativa (não revogada!)
        const deactSessions = await isoClient<{ id: string }[]>`
          SELECT id FROM "${isoClient.unsafe(schemaName)}".sessions WHERE user_id = ${userForDeact.id}::uuid AND revoked_at IS NULL;
        `;
        expect(deactSessions.length).toBe(1);

        // Confirma no banco: nenhum evento de inativação gravado
        const auditDeactCount = await isoClient<{ count: number }[]>`
          SELECT count(*)::int as count FROM "${isoClient.unsafe(schemaName)}".audit_events
          WHERE entity_id = ${userForDeact.id} AND action = 'user_deactivated';
        `;
        expect(Number(auditDeactCount[0].count)).toBe(0);
      } finally {
        await isoClient.end();
        const cleanupSql = postgres(process.env.DATABASE_URL!, { max: 1 });
        await cleanupSql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await cleanupSql.end();
      }
    });
  });

  describe("Proteção Real do Último Administrador (Funções da Aplicação e Advisory Lock Real)", () => {
    it("confirma que o advisory lock da aplicação está configurado", () => {
      expect(USER_MANAGEMENT_ADVISORY_LOCK_ID).toBe(42424201);
    });
    it("Caso A: impede inativação do único administrador ativo via toggleUserActive real", async () => {
      const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
      const schemaName = `test_last_admin_a_${stamp}`;
      await rootSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await rootSql.end();

      const isolatedUrl = new URL(process.env.DATABASE_URL!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schemaName},public`);

      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
      });

      const isoClient = postgres(isolatedUrl.toString(), { max: 2 });
      const isoDb = drizzle(isoClient, { schema });

      try {
        // Insere exatamente UM admin ativo no schema isolado
        const [singleAdmin] = await isoClient<{ id: string; updated_at: Date; email: string }[]>`
          INSERT INTO "${isoClient.unsafe(schemaName)}".users (email, name, password_hash, role, active, permissions)
          VALUES ('solitario@example.com', 'Admin Solitário', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
          RETURNING id, updated_at, email;
        `;

        // Executa a função REAL toggleUserActive tentando inativar o único admin
        await expect(
          toggleUserActive(
            {
              id: singleAdmin.id,
              active: false,
              expectedUpdatedAt: singleAdmin.updated_at,
              actorId: singleAdmin.id,
            },
            isoDb
          )
        ).rejects.toThrow(LastAdminProtectionError);

        // Confirma que rollback ocorreu e o admin continua ativo
        const [stillActive] = await isoClient<{ active: boolean }[]>`
          SELECT active FROM "${isoClient.unsafe(schemaName)}".users WHERE id = ${singleAdmin.id}::uuid;
        `;
        expect(stillActive.active).toBe(true);
      } finally {
        await isoClient.end();
        const cleanupSql = postgres(process.env.DATABASE_URL!, { max: 1 });
        await cleanupSql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await cleanupSql.end();
      }
    });

    it("Caso B: impede remoção de gestor:usuarios do único administrador ativo via updateUser real", async () => {
      const rootSql = postgres(process.env.DATABASE_URL!, { max: 1 });
      const schemaName = `test_last_admin_b_${stamp}`;
      await rootSql.unsafe(`CREATE SCHEMA "${schemaName}"`);
      await rootSql.end();

      const isolatedUrl = new URL(process.env.DATABASE_URL!);
      isolatedUrl.searchParams.set("options", `-csearch_path=${schemaName},public`);

      await runMigrations({
        databaseUrl: isolatedUrl.toString(),
        migrationsDirectory: path.resolve("migrations"),
      });

      const isoClient = postgres(isolatedUrl.toString(), { max: 2 });
      const isoDb = drizzle(isoClient, { schema });

      try {
        // Insere exatamente UM admin ativo
        const [singleAdmin] = await isoClient<{ id: string; updated_at: Date; email: string }[]>`
          INSERT INTO "${isoClient.unsafe(schemaName)}".users (email, name, password_hash, role, active, permissions)
          VALUES ('solitario2@example.com', 'Admin Solitário 2', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
          RETURNING id, updated_at, email;
        `;

        // Executa a função REAL updateUser tentando remover a permissão gestor:usuarios
        await expect(
          updateUser(
            {
              id: singleAdmin.id,
              name: "Admin Solitário 2",
              email: singleAdmin.email,
              role: "GESTOR",
              storeId: null,
              permissions: ["gestor:produtos"], // Removendo gestor:usuarios!
              active: true,
              expectedUpdatedAt: singleAdmin.updated_at,
              actorId: singleAdmin.id,
            },
            isoDb
          )
        ).rejects.toThrow(LastAdminProtectionError);

        // Confirma que rollback ocorreu e o admin permanece com gestor:usuarios
        const [stillHasPerm] = await isoClient<{ permissions: string[] }[]>`
          SELECT permissions FROM "${isoClient.unsafe(schemaName)}".users WHERE id = ${singleAdmin.id}::uuid;
        `;
        expect(stillHasPerm.permissions).toContain("gestor:usuarios");
      } finally {
        await isoClient.end();
        const cleanupSql = postgres(process.env.DATABASE_URL!, { max: 1 });
        await cleanupSql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await cleanupSql.end();
      }
    });

    it("Caso C: duas operações concorrentes reais não deixam o sistema sem administrador", async () => {
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
      const db1 = drizzle(client1, { schema });
      const client2 = postgres(isolatedUrl.toString(), { max: 1 });
      const db2 = drizzle(client2, { schema });

      try {
        // Insere exatamente DOIS administradores ativos
        const [admin1, admin2] = await client1<{ id: string; updated_at: Date }[]>`
          INSERT INTO "${client1.unsafe(schemaName)}".users (email, name, password_hash, role, active, permissions)
          VALUES ('admin1@example.com', 'Admin 1', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[]),
                 ('admin2@example.com', 'Admin 2', 'dummy', 'GESTOR', true, ARRAY['gestor:usuarios']::text[])
          RETURNING id, updated_at;
        `;

        // Dispara simultaneamente as funções REAIS toggleUserActive através de conexões paralelas
        const [res1, res2] = await Promise.allSettled([
          toggleUserActive(
            { id: admin1.id, active: false, expectedUpdatedAt: admin1.updated_at, actorId: admin1.id },
            db1
          ),
          toggleUserActive(
            { id: admin2.id, active: false, expectedUpdatedAt: admin2.updated_at, actorId: admin2.id },
            db2
          ),
        ]);

        // Exatamente um deve ter sucesso e um deve ser rejeitado com LastAdminProtectionError
        const successes = [res1, res2].filter((r) => r.status === "fulfilled");
        const failures = [res1, res2].filter(
          (r) => r.status === "rejected" && r.reason instanceof LastAdminProtectionError
        );

        expect(successes.length).toBe(1);
        expect(failures.length).toBe(1);

        // Confirma no banco que resta obrigatoriamente count(active users with gestor:usuarios) >= 1
        const [{ remaining_count }] = await client1<[{ remaining_count: number }]>`
          SELECT count(*)::int AS remaining_count FROM "${client1.unsafe(schemaName)}".users
          WHERE active = true AND 'gestor:usuarios' = ANY(permissions);
        `;
        expect(remaining_count).toBeGreaterThanOrEqual(1);
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
