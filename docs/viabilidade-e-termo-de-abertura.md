# Viabilidade e termo de abertura

## Resumo executivo

O projeto é tecnicamente exequível no servidor atual e tem forte aderência operacional: substitui tarefas já existentes, preservando o fluxo aprovado. A viabilidade financeira é favorável por reutilizar infraestrutura e GHCR/GitHub Actions, mas custos humanos, backup externo e eventual expansão de armazenamento precisam ser orçados pelo patrocinador.

## Viabilidade

| Dimensão | Avaliação | Condição |
|---|---|---|
| Técnica | Viável com ressalvas | 4 vCPU/4 GiB e Swarm single-node atendem início; PostgreSQL 18.6 foi confirmado |
| Operacional | Viável | UX móvel deve ser validada em campo com Loja e Comprador |
| Financeira | Provavelmente viável | Sem estimativa monetária autorizada; medir operação, backup e manutenção |
| Segurança | Viável com controles | RBAC no servidor, TLS, secrets, backup, logs e atualização de dependências |
| Continuidade | Risco moderado | Nó único é ponto único de falha; recuperação precisa ser ensaiada |

## Objetivo estratégico

Criar uma fonte única e rastreável para o ciclo diário de FLV, reduzindo retrabalho, perda de histórico e incerteza sobre pedidos, compras, embarques e notas.

## Termo de abertura

- **Patrocinador/aprovador:** Gestor MultiShow *(premissa — confirme ou corrija)*.
- **Usuários-chave:** representantes das três lojas, Comprador e Gestor.
- **Resultado:** PWA em `compras.muitomaisatacado.com`, implantada por stack e operável por Portainer.
- **Escopo inicial:** funcionalidades descritas nos PRDs 001–006.
- **Restrições:** preservar UX aprovada; sem conversões automáticas nem integrações ERP; execução em Docker Swarm.
- **Critério de autorização para produção:** UAT dos três papéis, restauração de backup testada, checklist de segurança/release concluído e rollback ensaiado.
- **Governança:** mudanças via PRD/OpenSpec/ADR; criticidade P0/P1/P2; evidências em CI e documentação de estado.

## Riscos principais

| Risco | Probabilidade | Impacto | Tratamento |
|---|---|---|---|
| Nó único indisponível | Média | Alto | backup externo, runbook e futura réplica/host alternativo |
| Falha no PostgreSQL compartilhado | Média | Alto | database/role próprios, backup e restauração testados |
| Credencial de webhook vazada | Baixa | Alto | GitHub secret, rotação e nunca registrar URL em logs |
| Imagens `latest` em stacks atuais | Média | Médio | fixar versões/digests em mudanças futuras |
| Adoção móvel insuficiente | Média | Alto | UAT em aparelhos reais e preservação das referências aprovadas |
| Dados importados incorretos | Média | Alto | importação idempotente, relatório de validação 74/21 e revisão do Gestor |
