'use client';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function Qr({
  texto,
  tamanho = 200,
  rotulo,
}: {
  texto: string;
  tamanho?: number;
  rotulo: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(texto, { margin: 1, width: tamanho }).then(setSrc);
  }, [texto, tamanho]);
  return src ? (
    <img
      src={src}
      width={tamanho}
      height={tamanho}
      alt={rotulo}
      style={{ display: 'block', margin: '0 auto', background: '#fff', borderRadius: 8 }}
    />
  ) : null;
}
