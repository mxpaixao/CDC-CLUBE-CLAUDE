'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Aviso } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { useAcao } from '@/lib/hooks';

const COMUNICACAO = [
  { tipo: 'MARKETING_WHATSAPP', rotulo: 'Avisos e ofertas por WhatsApp' },
  { tipo: 'MARKETING_SMS', rotulo: 'Avisos e ofertas por SMS' },
  { tipo: 'MARKETING_EMAIL', rotulo: 'Avisos e ofertas por e-mail' },
];

export default function Aderir() {
  const router = useRouter();
  const [f, setF] = useState({
    tipo: 'CPF' as 'CPF' | 'EMPRESA',
    cpf: '',
    nome: '',
    telefone: '',
    email: '',
    cnpj: '',
    razaoSocial: '',
  });
  const [consent, setConsent] = useState<Record<string, boolean>>({
    ADESAO_PROGRAMA: false,
    MARKETING_WHATSAPP: false,
    MARKETING_SMS: false,
    MARKETING_EMAIL: false,
  });
  const [codigo, setCodigo] = useState('');
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);
  const { enviando, erro, executar } = useAcao();
  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  const pedirCodigo = () =>
    executar(async () => {
      const r = await api<{ enviadoPara: string }>('/participantes/adesao/otp', {
        body: { cpf: f.cpf, telefone: f.telefone },
      });
      setEnviadoPara(r.enviadoPara);
    });
  const confirmar = () =>
    executar(async () => {
      await api('/participantes/adesao', {
        body: {
          tipo: f.tipo,
          cpf: f.cpf,
          nome: f.nome,
          email: f.email || null,
          cnpj: f.tipo === 'EMPRESA' ? f.cnpj : null,
          razaoSocial: f.tipo === 'EMPRESA' ? f.razaoSocial : null,
          codigo,
          consentimentos: consent,
        },
      });
      router.replace('/app'); // a adesão já abre a sessão
    });

  return (
    <div className="cartao pilha">
      <h1>Entrar no Clube CDC</h1>
      <p className="suave">Ganhe crédito em cada compra nas lojas CDC.</p>
      {!enviadoPara ? (
        <form
          className="pilha"
          onSubmit={(e) => {
            e.preventDefault();
            void pedirCodigo();
          }}
        >
          <div className="linha" role="radiogroup" aria-label="Tipo de participante">
            <label className="check">
              <input
                type="radio"
                name="tipo"
                checked={f.tipo === 'CPF'}
                onChange={() => setF({ ...f, tipo: 'CPF' })}
              />
              Pessoa física
            </label>
            <label className="check">
              <input
                type="radio"
                name="tipo"
                checked={f.tipo === 'EMPRESA'}
                onChange={() => setF({ ...f, tipo: 'EMPRESA' })}
              />
              Empresa (CNPJ)
            </label>
          </div>
          <label className="campo">
            {f.tipo === 'EMPRESA' ? 'CPF do responsável' : 'CPF'}
            <input inputMode="numeric" value={f.cpf} onChange={muda('cpf')} required />
          </label>
          <label className="campo">
            Nome completo
            <input value={f.nome} onChange={muda('nome')} autoComplete="name" required />
          </label>
          <label className="campo">
            Celular com DDD
            <input
              inputMode="tel"
              value={f.telefone}
              onChange={muda('telefone')}
              autoComplete="tel"
              placeholder="(92) 99999-9999"
              required
            />
          </label>
          <label className="campo">
            E-mail (opcional)
            <input type="email" value={f.email} onChange={muda('email')} autoComplete="email" />
          </label>
          {f.tipo === 'EMPRESA' && (
            <>
              <label className="campo">
                CNPJ
                <input value={f.cnpj} onChange={muda('cnpj')} required />
              </label>
              <label className="campo">
                Razão social
                <input value={f.razaoSocial} onChange={muda('razaoSocial')} required />
              </label>
            </>
          )}
          <fieldset className="cartao" style={{ boxShadow: 'none' }}>
            <legend className="suave">Consentimentos (LGPD)</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={consent.ADESAO_PROGRAMA}
                onChange={(e) => setConsent({ ...consent, ADESAO_PROGRAMA: e.target.checked })}
              />
              <span>
                Li e aceito o <Link href="/app/regras">regulamento do Clube</Link> e o tratamento
                dos meus dados para operar o programa. <strong>(obrigatório)</strong>
              </span>
            </label>
            <small>Comunicação é opcional e independente da adesão:</small>
            {COMUNICACAO.map((c) => (
              <label key={c.tipo} className="check">
                <input
                  type="checkbox"
                  checked={!!consent[c.tipo]}
                  onChange={(e) => setConsent({ ...consent, [c.tipo]: e.target.checked })}
                />
                {c.rotulo}
              </label>
            ))}
          </fieldset>
          <button className="botao largo" disabled={enviando || !consent.ADESAO_PROGRAMA}>
            Receber código por SMS/WhatsApp
          </button>
        </form>
      ) : (
        <form
          className="pilha"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar();
          }}
        >
          <Aviso tipo="info">Código enviado para {enviadoPara}.</Aviso>
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
            Confirmar adesão
          </button>
        </form>
      )}
      <Aviso>{erro}</Aviso>
    </div>
  );
}
