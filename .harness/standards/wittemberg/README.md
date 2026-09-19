# Witteberg Development Standards

Repositório corporativo de padrões reutilizáveis de desenvolvimento, UX, UI, operação, arquitetura e entrega técnica.

Este repositório nasceu da consolidação de decisões já testadas e aprovadas durante o desenvolvimento do **Witiquetas** e deve servir como baseline para projetos futuros da empresa.

## Princípio central

> Se o sistema consegue se recuperar sozinho, ele deve se recuperar sozinho. Se não consegue, deve identificar a causa com precisão e dizer quem deve agir.

## Estrutura

- `frontend/` — design system, UX, responsividade, acessibilidade e escrita
- `components/` — padrões de botões, cards, modais, formulários e estados
- `patterns/` — erros, downloads, agents, estados operacionais e loading/empty states
- `engineering/` — qualidade, estabilidade, persistência, severidade e não-regressão
- `templates/` — modelos de especificação e prompts para desenvolvimento
- `checklists/` — revisão de frontend, release e início de novos projetos
- `assets/` — organização de artes, referências visuais e ativos aprovados

## Baseline obrigatória

- Zoom do navegador em **100%** é a referência visual.
- Nenhuma ação, badge, campo, card, modal ou componente pode extrapolar seu container.
- Nenhuma ação pode falhar silenciosamente.
- Responsividade deve ser validada em desktop, notebook, tablet e mobile.
- Telas visualmente aprovadas passam a ser **baseline congelada**.
- Mudanças devem ser cirúrgicas e preservar o que já foi validado.
- P0 bloqueia operação, segurança ou confiabilidade.
- P1 é importante, mas não bloqueia o fluxo principal.
- P2 é refinamento.

## Como usar em novos projetos

Antes de criar uma solução nova, consultar este repositório. Não recriar componentes ou padrões já aprovados sem justificativa explícita.

Ao iniciar um projeto novo, a documentação técnica deve declarar que este repositório é a baseline corporativa adotada.

## Origem

Primeira consolidação: **Witiquetas Térmicas**.

Status: **Normativo / Reutilizável**.
