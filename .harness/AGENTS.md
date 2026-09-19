# Orientação para agentes

Esta biblioteca reúne as preferências de Wittemberg. Caminhos são relativos a este arquivo, inclusive em `.harness/`. Leia apenas o necessário para a tarefa.

## Entrada e fluxo

1. Leia as instruções do projeto de destino, seu estado atual e os arquivos pertinentes antes de propor mudanças. Preserve contratos e decisões válidas.
2. Para iniciar ou realinhar, consulte [iniciar-projeto](skills/iniciar-projeto/SKILL.md) e a seção pertinente do [manual](docs/manual.md). Correção pequena não exige um novo ciclo documental.
3. Para mudança relevante, prefira um ciclo OpenSpec: propor → implementar → verificar → arquivar. Continue mudanças existentes; não duplique capacidades ou tarefas.
4. Boilerplates só é base para projeto novo compatível. Nunca aplique um template por cima de um projeto existente. PRD/TRD/brainstorm são opcionais conforme a lacuna.
5. Consulte [skills](skills/README.md) ou [catálogo](catalog/README.md) só quando faltar uma capacidade. AG Kit, ECC e afonsoft são alternativas de consulta, não orquestradores cumulativos. Veja o [filtro](docs/curadoria.md).

## Preferências

- Adote a [baseline Wittemberg](standards/wittemberg/README.md) com aplicabilidade explícita. Leia somente os padrões afetados; registre adoção e exceções no TRD/design ou decisão existente.
- Preserve interfaces e comportamentos aprovados. Evite redesenho incidental e mudanças em consumidores não relacionados.
- Em interfaces, confira zoom de 100%, responsividade, teclado, feedback e overflow. Reuse tokens existentes.
- Persista identidades, configurações e estados necessários após reinício. Agentes locais precisam recuperar conexões e distinguir falhas de rede, hardware e aplicação.
- Identifique premissas. Fatos externos voláteis exigem fonte e data; catálogo não garante preço, disponibilidade ou segurança.
- Relate resultados, evidências e limitações reais. Não declare execução de testes ou ferramentas que não ocorreram.

## Contexto e permissões

Instruções explícitas do usuário e regras do ambiente têm precedência. Se a biblioteca conflitar com contratos do projeto, registre o conflito e proponha a resolução concreta. Um original importado não revoga autorização já dada nem amplia permissões para instalação global, mensagens, compras ou implantação.

`upstream/` e inventários são referências passivas. Não leia, execute ou instale tudo. Regras importadas de orquestração não exigem subagentes. Brainstorm não captura automaticamente implementação clara e autorizada.

Mantenha uma fonte canônica por requisito/decisão/tarefa. Retome pelo estado curto e pela mudança ativa; não copie specs, catálogos ou logs inteiros para o contexto inicial. Dependências e ferramentas mencionadas nas fontes não estão automaticamente instaladas: veja [compatibilidade](docs/compatibilidade.md).

## Manutenção

Preserve os originais. Registre fontes GitHub em [sources.lock.json](sources.lock.json) e bundles locais em [local-sources.lock.json](local-sources.lock.json). Adaptações ficam fora dos snapshots. Após mudanças relevantes, execute `python scripts/validate.py` e `python -m unittest discover -s tests -v`. Veja [manutenção](docs/manutencao.md).
