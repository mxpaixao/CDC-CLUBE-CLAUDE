'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Aviso } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { useAcao } from '@/lib/hooks';

export default function EntrarPainel() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const { enviando, erro, executar } = useAcao();
  const entrar = () =>
    executar(async () => {
      const r = await api<{ usuario: { permissoes: string[] } }>('/auth/equipe/login', {
        body: { email, senha },
      });
      const p = r.usuario.permissoes;
      router.replace(
        p.includes('admin') || p.includes('visualizacao_relatorios')
          ? '/painel'
          : p.includes('operacao_caixa')
            ? '/painel/caixa'
            : '/painel/clientes',
      );
    });
  return (
    <main className="inicio" style={{ maxWidth: 420 }}>
      <form
        className="cartao pilha"
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
      >
        <div className="marca">
          <img src="/icone.svg" alt="" /> Painel CDC
        </div>
        <h1>Entrar</h1>
        <label className="campo">
          E-mail
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="campo">
          Senha
          <input
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
          />
        </label>
        <button className="botao largo" disabled={enviando}>
          Entrar
        </button>
        <Aviso>{erro}</Aviso>
      </form>
    </main>
  );
}
