# Design

## Context

O projeto já possui Next.js, PostgreSQL/Drizzle, sessões com RBAC, catálogo importado e um módulo ordering inicial. O desenho deve preservar isolamento server-side por `store_id`, histórico imutável e a redeployabilidade OCI/Swarm descrita no TRD. Ver `proposal.md` e a especificação desta mudança para o contrato funcional.

## Goals / Non-Goals

**Goals:**

- Consolidar rascunho, envio, histórico e conferência em transações PostgreSQL.
- Manter UX mobile-first em cards e ações fixas, com acessibilidade de teclado e impressão A4.
- Garantir conflitos de versão e autorização antes de qualquer leitura ou escrita.
- Cobrir comportamento com testes unitários, integração e Playwright.

**Non-Goals:**

- Não introduzir sincronização offline complexa, conversão de unidades ou aprovação de pedidos.
- Não alterar o pipeline, a topologia Swarm ou o contrato de autenticação existente.

## Decisions

1. **Rascunho no PostgreSQL com versão otimista.** A tabela de rascunho continua tendo uma linha por loja/data e itens filhos; a versão esperada é conferida na mesma transação. Isso evita perda silenciosa entre aparelhos. LocalStorage isolado foi rejeitado porque não atende persistência compartilhada.
2. **Envio imutável por revisão.** Cada envio cria uma linha de pedido e seus itens, com revisão crescente por loja/data. Atualizar a mesma linha foi rejeitado por destruir auditoria e impedir conferência histórica.
3. **Autorização no servidor.** Toda action e consulta recebe o principal da sessão e valida a loja solicitada; ocultar controles no React não é considerado segurança.
4. **Relatório HTML imprimível.** A conferência usa a rota autenticada e CSS de impressão A4, sem gerar PDF no servidor. Um gerador PDF dedicado aumentaria dependências sem benefício para o primeiro marco.
5. **Produtos ativos no workspace.** O catálogo é lido no servidor e itens históricos continuam resolvendo nome/unidade mesmo após inativação; o pedido não copia atributos mutáveis para evitar divergência.

## Risks / Trade-offs

- **[Risco]** Reenvio concorrente cria várias revisões legítimas. → Exibir revisão e horário claramente e testar auditoria.
- **[Risco]** Impressão depende do navegador/dispositivo. → Usar CSS de impressão determinístico e validar Playwright/viewport real.
- **[Risco]** Uma falha após salvar rascunho pode deixar o usuário sem confirmação visual. → Retornar estado explícito da action e permitir recarregar a versão persistida.
- **[Risco]** O catálogo pode mudar durante um rascunho. → Resolver dados atuais na tela e congelar somente o conteúdo do envio por suas relações de produto.

## Migration Plan

1. Validar schema/migration em PostgreSQL efêmero e executar testes unitários/integrados.
2. Executar Playwright em 360 px, acessibilidade e fluxo de revisão/conferência.
3. Publicar imagem imutável pelo workflow; Portainer aplica via webhook.
4. Validar smoke test e manter a imagem anterior como rollback; nenhuma migração destrutiva é permitida.

## Open Questions

- A regra de reenvio no mesmo dia será confirmada pelos representantes das lojas durante o UAT; a implementação proposta mantém todas as revisões, sem sobrescrita.
