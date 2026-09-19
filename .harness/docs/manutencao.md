# Manutenção da biblioteca

## Arquivos autorais e originais

Edite as skills locais, as fichas e os guias conforme as preferências do usuário. Preserve os originais identificados em [sources.lock.json](../sources.lock.json). Mudanças nos padrões corporativos devem preferencialmente acontecer no repositório de origem e depois ser importadas.

O lockfile registra 23 fontes GitHub, as 25 URLs solicitadas, os commits, os caminhos importados e os hashes SHA-256. `catalog/inventories/` registra a árvore upstream no mesmo commit. A licença detectada é metadado, não substitui os termos nos arquivos de licença.

## Verificar e restaurar

```sh
python scripts/validate.py
python -m unittest discover -s tests -v
python scripts/sources.py --check-upstream
```

`--check-upstream` consulta o GitHub para comparar a branch padrão atual com o commit fixado, sem atualizar snapshots ou lockfile. Requer rede; limites da API podem interromper a consulta, e falhas são relatadas.

Para restaurar apenas arquivos importados que estejam ausentes:

```sh
python scripts/sources.py --restore-missing
```

A restauração usa a versão do lockfile e valida o SHA-256 antes de escrever. Arquivos existentes não são sobrescritos: diferenças devem ser revisadas. Não recupera arquivos autorais, que devem vir do Git.

## Importar uma versão nova

1. Consulte alterações upstream e escolha um commit explícito. Revise mudanças de licença, runtime e dependências.
2. Baixe os arquivos selecionados desse commit em uma pasta de trabalho separada. Não execute os scripts baixados como parte da coleta.
3. Compare os originais anteriores com os candidatos. Preserve a pasta completa quando a skill depender de referências, scripts ou assets. Documente o que fica de fora.
4. Atualize o snapshot, a ficha, o inventário da árvore e a entrada correspondente no lockfile, incluindo SHA-256 e data de consulta. Não atualize hashes somente para silenciar uma falha de integridade.
5. Revise links locais, dependências entre skills e `THIRD_PARTY_NOTICES.md`. Execute a validação e os testes; faça commit do conjunto como uma alteração revisável.

A atualização intencional é manual nesta primeira versão. Não há job que substitua automaticamente as preferências pessoais pelo conteúdo mais recente das fontes.

## Adicionar uma favorita

Classifique-a como skill, padrão, catálogo ou ferramenta. Registre quando usar, requisitos, limitações, origem, commit e licença. Importe o necessário para o caso de uso e preserve os avisos. Adicione uma rota ao catálogo; promova ao núcleo somente quando houver motivo para carregamento frequente.

## Projetos já inicializados

A cópia em `.harness/` é um snapshot independente. Ela não acompanha automaticamente este repositório. Para atualizar um projeto, compare a cópia existente com a nova versão e revise as diferenças; o bootstrap se recusa a sobrescrevê-la. Preserve as adaptações e decisões daquele projeto.

## Bundles locais e seleção

`local-sources.lock.json` registra a Skill Creator copiada da instalação local, com origem portátil e hashes; não há commit GitHub conhecido. `sources.py --check-upstream` informa LOCAL SNAPSHOT para ela. Para restaurar seus arquivos, use o histórico deste repositório; o modo de restauração não busca uma versão arbitrária na máquina atual.

`core_skills` no manifesto registra as sete entradas disponíveis, não sete leituras obrigatórias. Mantenha o filtro em [curadoria](curadoria.md), o [manual](manual.md) e as fichas alinhados ao mudar o roteamento. Novas fontes não são promovidas automaticamente ao fluxo padrão.

Antes de publicar, rode validação de hashes/blobs/links e os testes locais. Os scripts não auditam a segurança do software importado. Não regenere arquivos de terceiros para resolver avisos de whitespace: preserve os bytes originais.
