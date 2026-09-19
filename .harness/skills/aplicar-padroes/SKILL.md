---
name: aplicar-padroes
description: Aplicar os padrões de desenvolvimento de Wittemberg a uma implementação ou revisão de software, com foco em interface, persistência, agentes locais e não regressão. Use quando esta baseline for adotada pelo projeto ou solicitada pelo usuário.
---

# Aplicar padrões Wittemberg

Leia a [baseline](../../standards/wittemberg/README.md) e selecione os documentos conforme o que será alterado:

| Área | Referências |
| --- | --- |
| Interface e acessibilidade | [Design system](../../standards/wittemberg/frontend/DESIGN-SYSTEM.md), [UX](../../standards/wittemberg/frontend/UX-GUIDELINES.md), [escrita](../../standards/wittemberg/frontend/WRITING-GUIDELINES.md) |
| Componentes e estados | [Botões, cards e modais](../../standards/wittemberg/components/BUTTONS-CARDS-MODALS.md), [formulários](../../standards/wittemberg/components/FORMS-STATUS.md) |
| Backend e dados | [Persistência](../../standards/wittemberg/engineering/PERSISTENCE-RELIABILITY.md), [segurança](../../standards/wittemberg/engineering/SECURITY-BASELINE.md) |
| Serviço ou daemon local | [Agents locais](../../standards/wittemberg/patterns/LOCAL-AGENTS.md), [distribuição](../../standards/wittemberg/patterns/DOWNLOADS-DISTRIBUTION.md) |
| Correção e entrega | [Não regressão](../../standards/wittemberg/engineering/QUALITY-NON-REGRESSION.md), [erros](../../standards/wittemberg/patterns/ERROR-HANDLING.md) |

Antes de editar componente compartilhado, identifique consumidores e baseline aprovada. Faça alterações no escopo da solicitação. Uma recomendação visual não autoriza redesenhar telas aprovadas.

Converta os padrões aplicáveis em critérios observáveis: largura e zoom para a UI; sobrevivência a reinício para persistência; reconexão para serviços; resultado e orientação para falhas. Não confunda agentes locais do produto com subagentes da IA de desenvolvimento.

Use o [checklist de frontend](../../standards/wittemberg/checklists/FRONTEND-REVIEW.md) quando houver UI e o [checklist de release](../../standards/wittemberg/checklists/RELEASE.md) quando houver entrega de software. Identifique itens não aplicáveis e evidências ainda não disponíveis. Não invente testes em produção.

Relate componentes tocados, risco de regressão, verificações executadas e limitações. Se uma regra corporativa conflitar com uma decisão aprovada do projeto, registre a divergência antes de alterar o contrato.
