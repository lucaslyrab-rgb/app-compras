# Downloads e Distribuição

## Binários

- Detectar plataforma quando possível.
- Permitir seleção manual.
- Não afirmar disponibilidade se o artefato não existir.
- Validar formato real do executável, não apenas a extensão.
- Gerar SHA-256 e tamanho.
- Testar `--version` e `--help` no runner nativo.

## Fail-closed

Artefato ausente deve retornar indisponibilidade controlada.

Nunca gerar arquivo mock com nome de executável real.

## Plataformas

Preparar arquitetura para:

- Windows x64
- Windows x86
- Windows ARM64
- Linux x64
- Linux ARM64
- macOS Intel
- macOS Apple Silicon
- FreeBSD x64

Variantes futuras aparecem como `Em breve`.
