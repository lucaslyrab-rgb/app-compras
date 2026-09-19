# Auditoria do servidor — 2026-09-19

Levantamento somente-leitura; nenhum serviço foi alterado.

## Host

| Item | Observado |
|---|---|
| Endereço/domínios | `177.136.234.214`; `servidor.muitomaisatacado.com`; `compras.muitomaisatacado.com` resolveu para o mesmo IP |
| Kernel | Linux 6.8.12-16-pve, x86_64 |
| Recursos visíveis ao ambiente | 4 vCPU, 4 GiB RAM, 2 GiB swap |
| Disco | ext4, 98 GiB; 16 GiB usados (17%) |
| Docker | Engine 29.8.1, overlayfs, cgroup systemd, log driver json-file |
| Swarm | ativo, 1 nó manager/leader, endereço `177.136.234.214:2377` |

## Stacks/serviços

| Stack | Imagem observada | Réplicas | Persistência |
|---|---|---:|---|
| traefik | `traefik:v3.5.3` fixada por digest | 1 | `volume_swarm_certificates` |
| portainer | `portainer/portainer-ee:latest` resolvida por digest | 1 + agent global | `portainer_data` |
| postgres | `postgres:14` resolvida por digest | 1 | `postgres_data` |
| pgadmin | `dpage/pgadmin4:latest` resolvida por digest | 1 | `pgadmin_data` |
| quepasa | `codeleaks/quepasa:latest` resolvida por digest | 1 | `quepasa_volume` |

Todos os serviços estão na rede overlay `externa`; somente Traefik publica 80/443. Traefik redireciona HTTP→HTTPS, usa ACME HTTP challenge e observa o provider Swarm. PostgreSQL e demais aplicações não expõem portas diretamente.

## Achados e recomendações

1. **PostgreSQL 14:** suporte termina em 12/11/2026. Não criar dependência nova sem plano; proposta: PostgreSQL 16 dedicado inicialmente.
2. **Tags `latest`:** dificultam reprodução/rollback apesar de o serviço atual registrar digest. Fixar versão/digest nos próximos ciclos de manutenção.
3. **Swarm single-node:** manager, aplicação e dados compartilham falha. Backup off-host e restauração ensaiada são gates de produção; HA futura exige outro nó/host.
4. **Recursos:** 4 GiB pedem limites/reservas e monitoramento; evitar microserviços e bancos redundantes sem medição.
5. **Traefik DEBUG:** log detalhado permanente pode aumentar disco e exposição operacional. Migrar para INFO após diagnóstico e configurar rotação em mudança separada.
6. **Docker socket:** Traefik acessa o socket do manager; é risco conhecido de alto privilégio. Não ampliar esse padrão para a aplicação.
7. **Swarm autolock:** desativado. Avaliar ativação apenas com procedimento seguro de guarda/recuperação da unlock key.
8. **Imagens:** adicionar scan, SBOM/proveniência e política de patches; não declarar segurança apenas por usar digest.

## Limitações

- Não foram lidos valores de environment variables, secrets, certificados, dados de volumes ou credenciais.
- Não foram executados testes de carga, restauração, portas externas ou varredura de vulnerabilidade.
- A existência de Portainer EE não confirma licença, configuração de usuários ou políticas internas.
