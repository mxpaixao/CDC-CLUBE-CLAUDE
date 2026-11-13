#!/usr/bin/env bash
# Certificado AUTOASSINADO para a primeira subida/homologação.
# Em produção, substitua por certificado da CDC (ou Let's Encrypt se houver DNS público).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/certs"
DOMINIO="${1:-clube.cdc.local}"
mkdir -p "$DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$DIR/clube.key" -out "$DIR/clube.crt" \
  -subj "/C=BR/ST=AM/L=Manaus/O=Casa das Correias/CN=$DOMINIO" \
  -addext "subjectAltName=DNS:$DOMINIO,DNS:localhost"
chmod 600 "$DIR/clube.key"
echo "certificado gerado em $DIR para $DOMINIO"
