'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Aviso } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { useAcao } from '@/lib/hooks';

function Entrar() {
  const router = useRouter();
  const voltar = useSearchParams().get('voltar') || '/app';
  const [cpf, setCpf] = useState('');
  const [codigo, setCodigo] = useState('');
  const [etapa, setEtapa] = useState<'cpf' | 'codigo'>('cpf');
  const [destino, setDestino] = useState<string | null>(null);
  const { enviando, erro, setErro, executar } = useAcao();

  const pedir = () =>
    executar(async () => {
      const r = await api<{ enviadoPara: string | null; cadastrado: boolean }>(
        '/auth/participante/otp',
        { body: { cpf } },
      );
      if (!r.cadastrado) return setErro('Não encontramos este CPF no Clube. Faça sua adesão.');
      setDestino(r.enviadoPara);
      setEtapa('codigo');
    });
  const entrar = () =>
    executar(async () => {
      await api('/auth/participante/entrar', { body: { cpf, codigo } });
      router.replace(voltar.startsWith('/app') ? voltar : '/app');
    });

  return (
    <div className="cartao pilha">
      <h1>Entrar</h1>
      {etapa === 'cpf' ? (
        <form
          className="pilha"
          onSubmit={(e) => {
            e.preventDefault();
            void pedir();
          }}
        >
          <label className="campo">
            CPF
            <input
              inputMode="numeric"
              autoComplete="username"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              required
            />
          </label>
          <button className="botao largo" disabled={enviando}>
            Receber código
          </button>
        </form>
      ) : (
        <form
          className="pilha"
          onSubmit={(e) => {
            e.preventDefault();
            void entrar();
          }}
        >
          <Aviso tipo="info">Enviamos um código para {destino}.</Aviso>
          <label className="campo">
            Código de 6 dígitos
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <button className="botao largo" disabled={enviando || codigo.length !== 6}>
            Entrar
          </button>
          <button type="button" className="botao secundario largo" onClick={() => setEtapa('cpf')}>
            Trocar CPF
          </button>
        </form>
      )}
      <Aviso>{erro}</Aviso>
      <p className="suave">
        Ainda não participa? <Link href="/app/aderir">Quero entrar no Clube</Link>
      </p>
    </div>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <Entrar />
    </Suspense>
  );
}
