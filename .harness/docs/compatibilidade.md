# Compatibilidade e composição

## Núcleo de planejamento

Os originais de Fabrício foram mantidos sem reescrita. Algumas referências pertencem ao ecossistema original e não foram fornecidas como capacidades desta biblioteca:

| Referência na origem | Situação aqui | Como proceder |
| --- | --- | --- |
| `brainstorm-for-systems` | Nome citado no TRD; não há skill com esse nome importada | Usar o documento de origem e a [lente de desenvolvimento](../skills/brainstorm/references/spec-desenvolvimento.md) da skill brainstorm |
| `sdd-especificar` | Não incluída | PRD e TRD continuam úteis isoladamente; não declarar SPEC/PLAN/TASKS gerados por uma skill ausente |
| `preparar-execucao`, `implementar-task` | Citadas em template; não incluídas | O agente deve carregar explicitamente o TRD ao implementar; não presumir carregamento automático |
| Context7 / WebSearch | Nomes de ferramentas na origem | Usar ferramentas de documentação disponíveis; registrar se a consulta não pôde ser feita |
| `$ARGUMENTS` | Convenção de invocação | Em leitura manual, usar o pedido do usuário como entrada |

Brainstorm preserva a discussão e exige uma transição consciente para execução. Isso se aplica quando a tarefa é explorar. Um pedido explícito de implementação não deve ser interrompido por um gatilho amplo da descrição da skill.

O PRD original distingue produto de execução, mantém IDs e dependências e congela PRDs concluídos. O TRD mantém seis seções globais e referencia ADRs. Números nos templates são exemplos, não requisitos já aprovados do novo projeto.

## Kits e ferramentas externos

| Fonte | O que o snapshot permite | O que depende de instalação/integração |
| --- | --- | --- |
| AG Kit | Consultar skills, referências e grafo de dependências | Antigravity, hooks, comandos, memória de execução e sincronização MCP |
| OpenDesign | Consultar protocolo, brief e orientação de frontend | Aplicação, daemon, craft injetado, plugins e exportação |
| Awesome LLM Apps | Ler exemplos de skills, scripts e avaliações | Runtimes, pacotes, modelos e chaves de cada aplicação |
| Scrapling | Ler skill e API documentada | Python, extras, browser e configuração MCP |
| Ollama | Estudar runtime, API e integrações | Binário, modelos e hardware apropriado |
| Langflow | Estudar construção e publicação de fluxos | Plataforma, componentes, persistência e implantação |
| OpenHands | Estudar Agent Canvas e seus backends | Canvas, Agent Server e serviços relacionados |

`upstream/open-design/skills/design-review/SKILL.md` se identifica como entrada de catálogo e encaminha ao gstack. Não contém o processo completo e seus assets. A skill `frontend-design` tem licença própria e dependências opcionais do ambiente OpenDesign; `design-brief` é mais restrita e usa um vocabulário visual predefinido. Não permita que defaults visuais substituam a marca aprovada.

Os repositórios podem divergir sobre estilo, gates, subagentes e comandos. Aplique apenas o módulo necessário, com a baseline do projeto e a instrução atual do usuário. Não una todos os arquivos de regras em um único prompt.

## OpenSpec, Boilerplates e inclusões de setembro de 2026

- **OpenSpec:** documentação e skills de referência não instalam a CLI. Consulte versão/runtime e comandos gerados no destino. O perfil padrão oferece o ciclo principal; verify/onboard e outras ações pertencem ao expandido. Não copie todas as skills e não misture instalações de versões distintas.
- **Boilerplates:** Python >=3.12, uv, make e utilitários POSIX; a base importada é específica para Python web com agente. Inicialize/renomeie antes de anexar `.harness/`. O AGENTS original usa PRDs por feature: registre no projeto a preferência por mudanças OpenSpec, preservando os originais na biblioteca.
- **Skill Creator:** bundle completo local, scripts Python com PyYAML. Use para criar skills, não como rotina de toda feature.
- **InsForge:** as skills importadas são internas ao desenvolvimento da plataforma; a integração pública para consumidores vive em outro repositório. Não confundir presença dos arquivos com backend ou MCP configurado.
- **Archify:** preserve o bundle e caminhos relativos; requer Node. Validação do renderizador e inspeção visual têm papéis distintos.
- **ECC / afonsoft / AG Kit:** selecionar uma especialidade quando necessária. Pipelines, hooks, memória e delegação não são ativados pela importação.
- **llmfit / Ollama:** análise de adequação de hardware e runtime de modelos são complementares, com instalações próprias.
- **Multica / OpenHands / Langflow / SecOps:** plataformas independentes, com serviços e dependências. Nenhuma é requisito do ciclo OpenSpec.

PRD, TRD, design de mudança e specs têm escopos diferentes. O [manual](manual.md) define os artefatos canônicos; não mantenha tarefas duplicadas entre OpenSpec e outro pipeline de SPEC/issues.
