---
name: iniciar-projeto
description: Iniciar ou realinhar um projeto com as preferências de Wittemberg, selecionando uma base compatível, um ciclo de mudanças e somente as referências necessárias. Use no início de um projeto ou ao mudar a direção de um projeto existente.
---

# Iniciar ou realinhar

Inspecione instruções locais, estado do Git, README, manifestos e documentos pertinentes. Identifique o resultado esperado e preserve decisões válidas. Leia a seção aplicável do [manual](../../docs/manual.md), não toda a biblioteca.

1. **Novo:** confira o [checklist](../../standards/wittemberg/checklists/NEW-PROJECT.md). Escolha stack por requisitos. Considere [Boilerplates](../../catalog/sources/boilerplates.md) somente para Python web + agente. Inicialize/renomeie antes de anexar a biblioteca.
2. **Existente:** investigue a área afetada, registre baseline e divergência desejada. Preserve estrutura, contratos e dados. Não converta todo o legado em documentação nem aplique boilerplate.
3. **Mudança relevante:** continue/crie uma mudança [OpenSpec](../../catalog/sources/openspec.md) com requisitos verificáveis e tarefas. Confirme runtime e integração disponíveis. Não afirme instalação pela presença do snapshot.
4. **Correção pequena e autorizada:** implemente e verifique conforme o processo do projeto, sem cerimônia adicional.

Abra outra skill apenas pela lacuna: [brainstorm](../brainstorm/SKILL.md) para explorar (alternativa a opsx:explore); [PRD](../escrever-prd/SKILL.md) para visão ampla; [TRD](../escrever-trd/SKILL.md) para arquitetura global; [padrões](../aplicar-padroes/SKILL.md) para engenharia aplicável; [recursos](../selecionar-recursos/SKILL.md) para integração ausente. Evite repetir a mesma decisão em documentos diferentes.

Entregue objetivo, escopo, decisões/premissas relevantes, evidência inicial e próximo trabalho. Pergunte apenas por lacunas de alto impacto não resolvidas pela investigação. Atualize o estado de retomada em marcos, mantendo tarefas canônicas na mudança. Siga a autorização do usuário sem reabrir decisões encerradas.
