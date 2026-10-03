# Exceções temporárias de segurança em dependências

Este documento registra exceções explícitas para vulnerabilidades sem correção
oficial disponível. O audit completo continua sendo executado em CI e Release
para manter cada ocorrência visível. O gate bloqueante de dependências de
produção é `npm audit --omit=dev --audit-level=high`.

## TEMPORÁRIO — GHSA-vfj7-8cjw-p6xm / CVE-2026-93687

- Severidade: **HIGH**.
- Pacote afetado: `braces <= 3.0.3`.
- Versão corrigida oficial: nenhuma publicada atualmente.
- Cadeia afetada: `eslint-config-next` → `@next/eslint-plugin-next` →
  `fast-glob` → `micromatch` → `braces`.
- Escopo: exclusivamente dependências de desenvolvimento e lint. A cadeia não
  é copiada para a imagem standalone de runtime.
- Verificação de runtime: `npm audit --omit=dev --audit-level=high` retorna zero
  vulnerabilidades e permanece como gate obrigatório.

### Justificativa

O npm não oferece supressão seletiva nativa por advisory. Como ainda não existe
uma versão corrigida de `braces`, o audit completo permanece visível, mas não
bloqueia isoladamente a publicação enquanto este for o único advisory aceito.
Vulnerabilidades HIGH ou CRITICAL em dependências de produção continuam
bloqueando CI e Release pelo audit com `--omit=dev`.

Qualquer advisory adicional exibido pelo audit completo exige triagem própria e
não está abrangido por esta exceção.

### Remoção

Remover esta exceção assim que houver versão oficial corrigida e compatível.
Na mesma alteração, atualizar o lockfile, restaurar o audit completo como gate
bloqueante e confirmar que os dois comandos retornam exit code zero:

```bash
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```
