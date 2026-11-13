'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Aviso, Carregando, Selo } from '@/componentes/basicos';
import { Qr } from '@/componentes/Qr';
import { api } from '@/lib/api';
import { brl, data, diasAte } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';

interface Carteira {
  id: string;
  tipo: 'CLIENTE' | 'PRESTADOR';
  empresa?: { razaoSocial: string; cnpj: string };
  saldos: {
    disponivelCentavos: number;
    pendenteCentavos: number;
    reservadoCentavos: number;
    devedorCentavos: number;
    proximoVencimento: { venceEm: string; valorCentavos: number } | null;
  };
}
interface Inicio {
  nome: string;
  participante: { status: string } | null;
  prestador: { status: string; codigo: string | null } | null;
  carteiras: Carteira[];
}

function rotulo(c: Carteira) {
  if (c.tipo === 'PRESTADOR') return 'Recompensas de indicação';
  return c.empresa ? `Empresa · ${c.empresa.razaoSocial}` : 'Meu cashback';
}

export default function InicioApp() {
  const { dados, erro, carregando } = useDados<Inicio>('/app/inicio');
  const [codigo, setCodigo] = useState<{ codigo: string; cpf: string; expiraEm: string } | null>(
    null,
  );
  const acao = useAcao();
  if (carregando) return <Carregando />;
  if (erro || !dados) return <Aviso>{erro?.message ?? 'Não foi possível carregar.'}</Aviso>;

  const usarNoCaixa = () =>
    acao.executar(async () => setCodigo(await api('/app/codigo-caixa', { body: {} })));

  return (
    <div className="pilha">
      <h1>Olá, {dados.nome.split(' ')[0]}!</h1>
      {!dados.participante && (
        <Aviso tipo="info">
          Você ainda não aderiu ao Clube como cliente. <Link href="/app/aderir">Aderir</Link>
        </Aviso>
      )}
      {dados.carteiras.length === 0 && (
        <Aviso tipo="info">Sua carteira aparece aqui após a adesão.</Aviso>
      )}
      {dados.carteiras.map((c) => (
        <section key={c.id} className="saldo-destaque pilha" aria-label={rotulo(c)}>
          <small>{rotulo(c)}</small>
          <div>
            <small>Saldo disponível</small>
            <div className="valor">{brl(c.saldos.disponivelCentavos)}</div>
          </div>
          {c.saldos.proximoVencimento && (
            <div>
              ⏳ {brl(c.saldos.proximoVencimento.valorCentavos)} vencem em{' '}
              {diasAte(c.saldos.proximoVencimento.venceEm)} dia(s) (
              {data(c.saldos.proximoVencimento.venceEm)})
            </div>
          )}
          <div className="linha">
            {c.saldos.pendenteCentavos > 0 && (
              <span className="selo">{brl(c.saldos.pendenteCentavos)} a liberar</span>
            )}
            {c.saldos.reservadoCentavos > 0 && (
              <span className="selo">{brl(c.saldos.reservadoCentavos)} reservado no caixa</span>
            )}
          </div>
          {c.saldos.devedorCentavos > 0 && (
            <Aviso tipo="alerta">
              Saldo devedor de {brl(c.saldos.devedorCentavos)} (devolução de compra com crédito já
              usado). Será abatido dos próximos créditos; resgates ficam suspensos até lá.
            </Aviso>
          )}
          <Link className="botao secundario pequeno" href={`/app/extrato?carteira=${c.id}`}>
            Ver extrato
          </Link>
        </section>
      ))}
      {dados.carteiras.length > 0 && (
        <div className="cartao pilha">
          <h2>Usar no caixa</h2>
          <p className="suave">
            Informe seu CPF ao operador ou mostre o código abaixo. Ele confirma que é você.
          </p>
          {codigo ? (
            <>
              <div className="codigo-grande" aria-live="polite">
                {codigo.codigo}
              </div>
              <Qr texto={codigo.cpf} rotulo="QR com seu CPF para o caixa" tamanho={180} />
              <small>
                Válido até{' '}
                {new Date(codigo.expiraEm).toLocaleTimeString('pt-BR', {
                  timeZone: 'America/Manaus',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                .
              </small>
            </>
          ) : (
            <button className="botao largo" onClick={usarNoCaixa} disabled={acao.enviando}>
              Gerar código para o caixa
            </button>
          )}
          <Aviso>{acao.erro}</Aviso>
        </div>
      )}
      {dados.prestador && (
        <p>
          <Selo tipo={dados.prestador.status === 'APROVADO' ? 'ok' : 'alerta'}>
            Prestador: {dados.prestador.status}
          </Selo>{' '}
          <Link href="/app/prestador">Área do prestador</Link>
        </p>
      )}
    </div>
  );
}
