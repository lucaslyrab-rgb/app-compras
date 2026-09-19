# Registro da revisão inicial

Data da curadoria: **16/09/2026**. Os horários UTC exatos, commits e arquivos importados estão em [sources.lock.json](../sources.lock.json).

## Método e alcance

Foram consultadas as 13 origens correspondentes às 15 URLs solicitadas. As árvores de arquivos foram recuperadas pela API do GitHub sem truncamento. Os documentos importados foram obtidos de URLs raw fixadas em commit, evitando misturar versões de uma mesma fonte.

As páginas publicadas de Fabrício não ficaram acessíveis pelo leitor web usado na sessão. A revisão utilizou os `SKILL.md`, referências, templates e páginas Markdown do repositório que publica esse site; os URLs originais permanecem no manifesto.

Houve leitura detalhada das três skills centrais, da referência de brainstorm, dos templates técnicos e dos 17 documentos de padrões pessoais; leitura de documentação de apresentação, compatibilidade e partes relevantes de arquitetura/instalação das ferramentas; inspeção de estrutura, categorias, convenções e limites dos grandes catálogos. A seleção dos bundles adicionais preserva referências e licenças existentes na pasta de origem.

**Limite explícito:** não foi feita leitura linha a linha de todo o código das 13 origens, nem revisão individual de todas as entradas dos grandes catálogos, nem auditoria integral de cada script importado. Os inventários incluem dezenas de milhares de arquivos; indexar ou baixar um arquivo não equivale a revisá-lo. Aplicações, serviços, MCPs e avaliações upstream não foram executados. A leitura minuciosa de todo esse universo continua fora da revisão inicial entregue.

## Achados que orientaram a organização

| Fonte | Achado | Consequência |
| --- | --- | --- |
| Brainstorm | Estados de decisão e lente especializada para sistemas | Referência preservada junto da skill; acionamento por intenção |
| PRD | Rascunho com premissas, IDs e dependências, separação de produto | Template e avaliação preservados; evitar duplicar arquitetura |
| TRD | Seis seções globais e modo ADR; cita skills externas | Templates preservados e dependências documentadas |
| Padrões pessoais | Baseline normativa, não regressão e confiabilidade | Importação integral e skill de aplicação contextual |
| AG Kit | Contrato de execução voltado ao Antigravity | Kit preservado como consulta, sem hooks ativos |
| Public APIs | Metadados úteis, mas candidatos precisam de validação | API não vira dependência automaticamente |
| Awesome MCP Servers | Implementações e transportes variados | Avaliação por cliente, acesso e runtime |
| OpenDesign | Skills, templates e plugins são conceitos distintos | Importação seletiva; design-review identificado como ponteiro |
| Awesome LLM Apps | Mistura exemplos de aplicações com skills próprias | Área agent_skills importada; demais exemplos indexados |
| Awesome | Catálogo de outros catálogos | Rota de descoberta, não norma de arquitetura |
| Scrapling | Parser, fetchers, browser, CLI e MCP têm requisitos distintos | Skill oficial preservada e extras explicitados na ficha |
| Free for Dev | Faixas gratuitas são dados sujeitos a mudança | Confirmar condições na fonte antes de escolher |
| Ollama | Runtime/modelos/integrações têm requisitos próprios | Não incluir pesos ou assumir privacidade de todo backend |
| Langflow | Fluxo pode ser servido por API/MCP | Separar protótipo, exportação e implantação |
| OpenHands | A árvore atual apresenta Agent Canvas e fronteiras entre repos | Evitar instruções históricas de instalação incompatíveis |

## Evidências reproduzíveis

- Os 407 arquivos originais importados têm SHA-256 no lockfile.
- Cada ficha aponta para o commit e o inventário da origem.
- A validação local confere integridade, caminhos, frontmatter do núcleo e links dos guias locais.
- Testes locais exercitam a cópia para novos projetos e a preservação de arquivos existentes; não comprovam compatibilidade de todos os assistentes ou funcionamento das ferramentas externas.

Para aprofundar uma fonte, selecione o componente que será adotado, leia suas dependências e scripts, execute suas verificações no ambiente apropriado e registre o resultado antes de promovê-lo a padrão do projeto.

## Ampliação e reorganização — 17/09/2026

Os números acima descrevem a primeira importação. A coleção atual inclui 23 fontes GitHub (25 URLs solicitadas) e um bundle local Skill Creator. Foram adicionadas Archify, InsForge, SecOps Orchestrator, ECC, System Design Primer, afonsoft/skills, llmfit, Multica, Boilerplates e OpenSpec. Inventários novos foram obtidos por API ou por árvore Git do commit fixado.

Foram revisados READMEs, termos de licença e documentação de uso/integração selecionada. Para Boilerplates, também estrutura, Makefile, instruções de agentes, manifesto e testes de exemplo. Para OpenSpec, fluxo padrão, adoção em projetos existentes, instalação, CLI, proposta e schema de artefatos. As fichas descrevem exatamente as árvores importadas; isso não implica leitura exaustiva de cada implementação interna ou auditoria dos grandes kits.

Skill Creator veio do pacote local informado na ficha; seus nove arquivos e licença foram preservados. A revisão classificou sobreposições em [curadoria](curadoria.md): OpenSpec é o ciclo principal; boilerplate é condicional; kits abrangentes ficam em reserva. Originais permanecem inalterados.

A validação da biblioteca confere proveniência, hashes, blobs Git, registro de skills e links autorais. Testes dos scripts cobrem preservação de arquivos e restauração. Aplicações externas, serviços, modelos, hooks, bancos e o boilerplate não foram instalados ou executados nesta curadoria; não há alegação de prontidão para produção ou redução de tokens medida.
