# Manual: iniciar, realinhar e continuar com pouco contexto

Use um fluxo principal, uma mudança ativa por vez e documentos com finalidades distintas. Consulte fontes extras somente quando houver uma lacuna. Este manual reduz retrabalho; não garante ausência de falhas nem um percentual fixo de economia de tokens.

## 1. Preparar o contexto uma vez

1. Abra o repositório **do projeto**. Leia seu `AGENTS.md`, README, manifestos e estado do Git. Identifique alterações locais antes de editar. Não confunda a biblioteca com o código do produto.
2. Disponibilize esta biblioteca por caminho local, ou use o bootstrap descrito no [README](../README.md). Preserve as instruções do projeto. Em equipe, prefira a cópia portátil `.harness/` e registre a revisão adotada.
3. Defina objetivo, resultado observável, restrições e o que fica fora. Reuse respostas existentes; pergunte apenas pelo que realmente altera escopo, compatibilidade ou critérios de aceite.
4. Classifique a tarefa pela tabela. Não comece lendo upstream, inventários ou todos os padrões.

| Situação | Caminho |
| --- | --- |
| Correção pequena, escopo e comportamento claros | Implementação direta + verificação apropriada; seguir exigências já existentes do projeto |
| Feature, mudança de contrato ou realinhamento relevante | Uma mudança OpenSpec |
| Ideia ainda indefinida | Uma exploração: brainstorm **ou** opsx:explore |
| Produto amplo com várias iniciativas | PRD global opcional; cada mudança referencia a parte pertinente |
| Arquitetura transversal | TRD/ADR opcional; design da mudança referencia a decisão global |

**Saída:** próximo resultado concreto, recursos selecionados e critérios de aceite. Não gere documentos só para preencher o fluxo.

## 2A. Projeto novo: selecionar a base

1. Confira requisitos antes de escolher stack. A [baseline Wittemberg](../standards/wittemberg/README.md) é o ponto de partida; leia o checklist e depois apenas os padrões aplicáveis.
2. O [Boilerplates de Fabrício](../catalog/sources/boilerplates.md) contém uma base Python web + agente: FastAPI, Jinja2, LangChain, PostgreSQL/SQLAlchemy, Alembic e pytest. Use somente se isso atender ao projeto. Para outra stack, crie uma base mínima apropriada; não introduza Python ou LLM apenas para aproveitar o template.
3. Se selecionado, copie **somente** `upstream/boilerplates/boilerplate-python-web-agent/` para um destino novo e vazio, preservando arquivos ocultos e `uv.lock`. A versão é o commit em sources.lock.json. Não copie a raiz de todos os boilerplates nem o histórico do repositório. Registre a origem no README do destino. A fonte não declara licença explícita; veja os [avisos](../THIRD_PARTY_NOTICES.md).
4. Leia o README e AGENTS copiados. Antes de anexar `.harness/`, rode a inicialização/renomeação do boilerplate: seu `make rename` percorre arquivos do diretório e pode atingir materiais anexados. Depois acrescente a referência da biblioteca, preservando o AGENTS do template.
5. Confira Python >=3.12, `uv`, `make` e shell/utilitários POSIX. Em ambiente compatível, use:

```sh
make init name=meu_agente
make test
make dev
```

No Windows, use um ambiente POSIX preparado, como WSL, ou adapte os comandos ao PowerShell após revisar o Makefile. Não trate `make init` como comando nativo de PowerShell. Sem renomear o pacote, os equivalentes principais são criar `.env` a partir de `.env.example` **só se ausente**, `uv sync`, `uv run pytest` e `uv run uvicorn my_agent_app.main:app --host 127.0.0.1 --port 8000 --reload`.

6. Verifique `/`, `/api/hello` e `/api/health`. O Hello World não requer banco nem chave de LLM. Só configure banco/LLM quando usados; credenciais demonstrativas do Compose não servem como configuração de produção. Não versione `.env`.
7. Descreva o projeto no AGENTS. Reconcile a documentação: o template sugere PRDs por feature; nesta preferência, OpenSpec é a fonte de requisitos da mudança. Registre essa decisão **no destino**, sem editar o snapshot original. Preserve PRD/TRD existentes e referencie-os quando úteis.

**Saída:** base executável com evidência de teste, instruções coerentes e primeira fatia de produto definida. Inicialização não significa produto pronto.

## 2B. Projeto existente: realinhar sem reiniciar

1. Não aplique o boilerplate sobre o código existente. Identifique arquitetura real, contratos públicos, persistência, documentação aprovada, CI e testes relacionados ao problema.
2. Rode as verificações existentes apropriadas e registre falhas anteriores separadamente. Falta de ambiente é resultado inconclusivo, não teste aprovado.
3. Descreva a diferença entre estado observado e resultado desejado. Separe bug, requisito novo e dívida técnica. Escolha a menor mudança que entregue valor sem reformular áreas não relacionadas.
4. Preserve PRD, TRD, ADRs e specs válidos. Se já há OpenSpec, examine mudanças abertas e continue a correta; não execute init nem crie outro nome para a mesma capacidade sem necessidade.
5. Se estiver adotando OpenSpec agora, documente apenas a área que será alterada. Não converta todo o legado nem reescreva todos os documentos. Uma spec deve distinguir comportamento observado de intenção ainda não implementada.
6. Para mudança de schema, autenticação, API ou estado persistido, inclua compatibilidade, migração, reversão e evidências correspondentes. Não execute migrações em produção como parte de uma simples revisão.

**Saída:** diagnóstico curto com links ao código, baseline de testes e uma mudança delimitada. A documentação cresce conforme as áreas são trabalhadas.

## 3. Preparar OpenSpec no destino

A importação é documentação, schemas e skills de referência; não contém uma CLI instalada. Consulte a [ficha](../catalog/sources/openspec.md) e o [guia oficial preservado](../upstream/openspec/docs/installation.md) ao instalar. O snapshot exige Node >=20.19.0 e declara versão 1.13.1; isso não prova que toda funcionalidade do commit esteja no pacote npm da mesma versão.

1. Confira `node --version` e, se disponível, `openspec --version`. Reuse a instalação compatível. Escolha e registre uma versão publicada verificável; não use `@latest` silenciosamente a cada projeto.
2. Quando a instalação global fizer parte do trabalho autorizado, substitua `VERSAO_ESCOLHIDA` por essa versão e execute no terminal:

```sh
npm install -g @fission-ai/openspec@VERSAO_ESCOLHIDA
openspec --version
openspec init --help
openspec init
```

3. Selecione apenas o assistente usado e o perfil padrão. Inspecione os arquivos gerados e preserve instruções próprias; não instale AG Kit, ECC e afonsoft junto para gerenciar o mesmo ciclo. Registre versão da CLI e caminhos gerados. Se init detectar configuração existente, revise antes de regenerar.
4. OpenSpec informa telemetria de uso. A documentação descreve `OPENSPEC_TELEMETRY=0` para desativá-la por ambiente; em PowerShell, `$env:OPENSPEC_TELEMETRY='0'` vale na sessão atual. Escolha conforme a política do projeto.
5. Mantenha contexto e regras do projeto curtos; use referências para documentos grandes. Não copie todos os padrões em `openspec/config.yaml`. Perfil expandido, stores beta e orquestração multiagente ficam fora do início padrão.

Se não puder instalar agora, registre a limitação e mantenha requisitos/tarefas em Markdown. Não declare comandos, validação ou integração OpenSpec funcionando sem executá-los. Integre à CLI posteriormente antes de afirmar conformidade.

## 4. Executar uma mudança de cada vez

Os comandos `/opsx:*` abaixo são invocados **na conversa com a IA**, não no terminal. A grafia varia por assistente; use a forma mostrada pelo init. Já `openspec ...` são comandos de terminal.

1. **Explorar, se necessário:** `/opsx:explore`. Se a solução já está clara, pule. Não repita uma exploração concluída com brainstorm.
2. **Propor:** `/opsx:propose nome-da-mudanca`. Identifique capacidade existente antes de criar outra. Leia os requisitos pertinentes completos, incluindo cenários. Gere apenas os artefatos exigidos pelo schema ativo: motivação em proposal, comportamento em specs, decisão técnica em design e tarefas verificáveis em tasks.
3. **Conferir:** escopo, critérios de aceite, compatibilidade e perguntas de alto impacto precisam estar resolvidos antes da implementação correspondente. O original de propose é voltado ao planejamento. Instruções explícitas do usuário e regras do ambiente continuam superiores; não invente nova aprovação se a execução já está autorizada.
4. **Implementar:** `/opsx:apply`. Trabalhe nas tarefas da mudança selecionada; marque cada uma concluída somente com evidência. Se surgir mudança de escopo, atualize os artefatos relacionados antes de continuar a parte afetada.
5. **Verificar:** execute testes, lint/build e verificações de integração adequados ao que mudou. Valide os artefatos com a CLI disponível, por exemplo:

```sh
openspec validate nome-da-mudanca --strict
```

Validação de specs verifica estrutura/consistência; não demonstra que o software atende aos requisitos. O comando de conversa `/opsx:verify` pertence ao perfil expandido e não é pré-requisito para testar o código.

6. **Arquivar:** após conferir tarefas e evidências, `/opsx:archive`. Revise o diff dos requisitos consolidados em `openspec/specs/` e do histórico. Não contorne falhas com `--no-validate` só para finalizar. Arquivamento não equivale a deploy.
7. **Entregar:** registre comportamento alterado, verificações executadas, limitações e próximo passo. Commit, revisão e publicação seguem o processo e a autorização do projeto.

Para deltas MODIFIED, preserve o requisito completo e seus cenários; uma cópia parcial pode perder conteúdo ao consolidar. Recursos recentes, como `skip_specs`, devem ser confirmados na versão instalada; não invente requisito funcional para satisfazer o validador de uma mudança só documental.

## 5. Uma fonte de verdade por finalidade

| Artefato | Guarda | Evite duplicar |
| --- | --- | --- |
| AGENTS do projeto | Comandos, restrições e ponteiros curtos | Catálogos inteiros e histórico da conversa |
| PRD opcional | Visão de produto, metas e escopo amplo | Cada cenário detalhado da mudança |
| TRD / ADR opcional | Arquitetura global e decisões duráveis | Todo design de cada feature |
| openspec/specs | Requisitos consolidados das áreas já documentadas | Backlog e intenções ainda não entregues |
| openspec/changes/nome | Delta, design e tarefas da mudança ativa | Um segundo pipeline SPEC/issues com o mesmo conteúdo |
| Estado curto de retomada | Mudança ativa, links, evidências e próximo passo | Cópia das specs ou diário de cada ferramenta |

Os documentos antigos preservados podem servir de contexto; ao resolver divergências, registre qual passa a ser canônico para aquela finalidade. Não mantenha duas listas de tarefas concorrentes.

## 6. Economizar tokens e retomar com segurança

- **Entrada:** AGENTS + objetivo + estado atual. Não anexe toda a biblioteca ou toda a conversa.
- **Busca:** encontre caminhos com `rg` e abra trechos pertinentes. Leia uma ficha antes de baixar ou carregar um kit inteiro.
- **Escopo:** uma mudança ativa e uma especialidade adicional somente se necessária. Subagentes não são padrão; contexto repetido também custa tokens.
- **Reuso:** consulte decisões documentadas; não reconstrua PRD/TRD nem reexecute exploração concluída. Releia arquivos que mudaram e dependências exigidas pelo workflow ativo.
- **Saídas:** registre conclusões, evidências e links, sem transcrever logs completos. Não corte cenários essenciais, segurança ou diagnóstico só para atingir um limite artificial.
- **Retomada:** mantenha `docs/estado-atual.md` curto, usando o [modelo](../templates/estado-atual.md), ou uma seção equivalente já existente. Atualize em marcos/pausas; tarefas continuam canônicas no OpenSpec.
- **Medição:** compare uso real por mudança no assistente. Menos arquivos no prompt reduz contexto potencial, mas não prova um número de tokens economizados.

Prompt para continuar:

> Leia o AGENTS e o estado atual. Retome a mudança indicada, confira o Git e os artefatos alterados desde a última evidência. Abra somente as dependências necessárias. Continue o próximo trabalho autorizado, sem refazer decisões válidas nem criar documentos duplicados. Atualize tarefas e evidências ao concluir.

## Critério de conclusão

Escopo entregue e coerente com os requisitos; verificações relevantes registradas; falhas e limitações explícitas; mudanças de dados/contratos tratadas; estado de retomada atualizado. Se algum item não puder ser concluído, declare a pendência em vez de marcar sucesso. Recursos adicionais só entram quando resolverem uma necessidade que o fluxo atual não cobre.
