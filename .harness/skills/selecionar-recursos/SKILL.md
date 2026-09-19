---
name: selecionar-recursos
description: Selecionar APIs, servidores MCP, serviços de infraestrutura e ferramentas de IA a partir do catálogo pessoal de Wittemberg, verificando adequação e documentação atual. Use quando uma escolha de integração ou ferramenta fizer parte do projeto.
---

# Selecionar recursos

Comece pela necessidade: capacidade exigida, ambiente, dados envolvidos, restrição de custo e critérios de aceite. Preserve ferramentas já adotadas que atendam ao caso.

Consulte o [catálogo](../../catalog/README.md) por categoria:

- APIs de produto: Public APIs.
- Ferramentas acessíveis ao agente: Awesome MCP Servers.
- Serviços com faixa gratuita: Free for Dev.
- Busca de bibliotecas por domínio: Awesome.
- Exemplos de agentes e RAG: Awesome LLM Apps.
- Design: OpenDesign; diagramas: Archify; arquitetura: System Design Primer.
- Especialidades de engenharia: escolher pontualmente entre AG Kit, ECC e afonsoft, sem ativar outro pipeline de gestão de mudanças.
- Extração web: Scrapling; modelos locais: Ollama e llmfit; fluxos visuais: Langflow; plataformas de agentes: OpenHands ou Multica.
- Backend opcional: InsForge; centralização de scanners: SecOps Orchestrator.

OpenSpec é o ciclo preferido de mudanças; Boilerplates é uma base condicional para projetos novos. Consulte o [filtro](../../docs/curadoria.md) para evitar recursos que dupliquem a arquitetura ou o processo já suficiente.

Use os snapshots para encontrar candidatos. Antes da decisão, consulte a documentação oficial atual dos candidatos relevantes: interface, versão, manutenção, requisitos, autenticação, custos, quotas e condições de uso. Registre URL e data. Se a consulta não estiver disponível, identifique o ponto não verificado, sem afirmar atualidade.

Compare apenas opções que atendam à necessidade. A tabela deve ligar cada opção a compatibilidade, esforço de integração, operação, custos conhecidos e limitações. Diferencie capacidade documentada de comportamento testado no projeto.

Para MCP, confirme cliente, transporte, permissões e credenciais necessárias. Para APIs, valide autenticação, HTTPS, CORS quando o navegador consumir diretamente, rate limits e erros. Para serviços gratuitos, confirme limites atuais e caminho de saída. Para modelos, confira recursos de hardware e licença do modelo específico.

Entregue recomendação justificada e um próximo passo verificável. Registre uma decisão durável no TRD/ADR quando fizer parte da tarefa. A escolha de uma ferramenta não instala nem conecta contas automaticamente.
