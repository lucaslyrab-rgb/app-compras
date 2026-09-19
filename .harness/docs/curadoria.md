# Filtro de necessidade e redundância

Não são necessárias todas as skills para um projeto. A seleção abaixo decide **ativação**, não apaga originais solicitados. Snapshots permanecem em upstream para rastreabilidade; nenhum kit é instalado automaticamente.

| Recurso | Decisão padrão | Motivo / gatilho para usar |
| --- | --- | --- |
| AGENTS + iniciar-projeto | Entrada única | Classifica novo, realinhamento ou tarefa pequena; lê apenas o necessário |
| Padrões Wittemberg | Baseline aplicável | Reusar contratos existentes; registrar exceções justificadas |
| OpenSpec | Um ciclo de mudanças | Proposal/specs/design/tasks substituem pipelines concorrentes de especificação |
| Boilerplates | Condicional | Só projeto novo Python web + agente; não é template universal |
| Brainstorm | Opcional | Ideia indefinida; escolher brainstorm OU opsx:explore na mesma exploração |
| Escrever PRD | Opcional | Visão de produto abrangente ou stakeholders; não repetir cada spec |
| Escrever TRD | Opcional | Arquitetura global; design.md fica restrito à mudança, ADR à decisão durável |
| Aplicar padrões | Sob demanda | Checklist do domínio afetado, sem reler os 17 documentos a cada tarefa |
| Selecionar recursos | Sob demanda | Só com necessidade técnica ainda não atendida |
| Skill Creator | Manutenção | Criar/alterar uma skill; não construir features do produto |
| AG Kit, ECC, afonsoft/skills | Reserva, fora do fluxo padrão | Sobreposição de planejar, implementar, testar e revisar; escolher uma skill especializada, não três orquestradores |
| Awesome, Public APIs, Awesome MCP, Free for Dev | Consulta pontual | Awesome por último; não pesquisar serviços se a stack já atende |
| Awesome LLM Apps | Exemplos | Buscar um caso relevante; não importar aplicações inteiras por padrão |
| OpenDesign, Archify | Design opcional | Interface ou diagrama necessário; finalidades diferentes |
| System Design Primer | Referência | Aprofundar um trade-off real; evitar arquitetura desproporcional |
| InsForge | Alternativa de backend | Pode sobrepor backend/persistência do boilerplate; escolher arquitetura antes de combinar |
| Scrapling | Extração específica | Apenas quando coleta web for requisito |
| Ollama + llmfit | Complementares opcionais | Runtime de modelos + avaliação do hardware |
| Langflow, OpenHands, Multica | Plataformas opcionais | Só se edição visual ou operação de agentes justificar mais infraestrutura; não são pré-requisitos para programar com IA |
| SecOps Orchestrator | Segurança opcional | Para centralizar scanners; começar com verificações apropriadas ao projeto |

## Regra para promover uma skill

Exigir necessidade recorrente, ganho concreto, compatibilidade, licença conhecida e ausência de alternativa já suficiente. Registrar o que ela substitui. Não adicionar ao AGENTS uma descrição longa de cada fonte.

Os bundles importados têm duplicação temática intencional no **arquivo de consulta**. A duplicação foi removida da **rota operacional**: um gerenciador de mudanças, um documento canônico por finalidade e no máximo uma especialidade adicional por necessidade. Não há promessa de eliminar toda duplicação interna de terceiros sem alterar seus originais.
