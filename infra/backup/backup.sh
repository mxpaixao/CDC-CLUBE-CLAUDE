#!/usr/bin/env bash
# Backup diário do PostgreSQL (pg_dump formato custom, comprimido) com retenção.
#   backup.sh agora      → faz um backup imediatamente
#   backup.sh agendar    → loop: backup diário em BACKUP_HORA (fuso America/Manaus)
#   backup.sh restaurar ARQUIVO → restaura (APAGA o banco atual; peça confirmação)
set -euo pipefail
PASTA="${BACKUP_PASTA_INTERNA:-/backups}"
RETENCAO="${BACKUP_RETENCAO_DIAS:-30}"
HORA="${BACKUP_HORA:-02:30}"

fazer_backup() {
  mkdir -p "$PASTA"
  local arquivo="$PASTA/clube_cdc_$(date +%Y-%m-%d_%H%M).dump"
  pg_dump --format=custom --compress=9 --no-owner --file="$arquivo.parcial"
  mv "$arquivo.parcial" "$arquivo"
  # verificação: o dump precisa ser legível
  pg_restore --list "$arquivo" > /dev/null
  sha256sum "$arquivo" > "$arquivo.sha256"
  find "$PASTA" -name 'clube_cdc_*.dump*' -mtime +"$RETENCAO" -delete
  echo "$(date -Is) backup ok: $arquivo ($(du -h "$arquivo" | cut -f1))"
}

case "${1:-agora}" in
  agora) fazer_backup ;;
  agendar)
    echo "backup diário agendado para $HORA ($TZ), retenção $RETENCAO dias"
    while true; do
      agora=$(date +%s)
      alvo=$(date -d "today $HORA" +%s)
      [ "$alvo" -le "$agora" ] && alvo=$(date -d "tomorrow $HORA" +%s)
      sleep $((alvo - agora))
      fazer_backup || echo "$(date -Is) FALHA no backup" >&2
    done ;;
  restaurar)
    arquivo="${2:?informe o arquivo .dump}"
    sha256sum -c "$arquivo.sha256"
    echo "Restaurando $arquivo em $PGDATABASE (o conteúdo atual será substituído)…"
    pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$arquivo"
    echo "restauração concluída" ;;
  *) echo "uso: $0 agora|agendar|restaurar ARQUIVO" >&2; exit 2 ;;
esac
