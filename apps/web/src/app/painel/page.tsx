'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Aviso, Carregando, Kpi } from '@/componentes/basicos';
import { brl, dataHora, pct } from '@/lib/formato';
import { useDados } from '@/lib/hooks';

interface Visao {
  periodoDias: number;
  geradoEm: string;
  adesoesPeriodo: number;
  participantesAtivos: number;
  participantesComCompra90d: number;
  recompra: {
    baseCompradores: number;
    em30diasBps: number | null;
    em60diasBps: number | null;
    em90diasBps: number | null;
  };
  vendasParticipantes: number;
  ticketMedioCentavos: number;
  vendasIndicadas: { quantidade: number; valorCentavos: number; recompensaCentavos: number };
  cashback: {
    emitidoCentavos: number;
    recompensaEmitidaCentavos: number;
    resgatadoCentavos: number;
    vencidoCentavos: number;
    estornadoCentavos: number;
    ajustesCentavos: number;
  };
  passivo: { pendenteCentavos: number; disponivelCentavos: number; saldoDevedorCentavos: number };
  alertas: {
    margemAbertos: number;
    abertos: number;
    divergenciasAbertas: number;
    prestadoresPendentes: number;
  };
}

export default function VisaoGeral() {
  const [dias, setDias] = useState(30);
  const { dados, erro, carregando } = useDados<Visao>(`/relatorios/visao-geral?dias=${dias}`);
  return (
    <div className="pilha">
      <div className="painel-cabecalho">
        <div>
          <h1>Visão geral</h1>
          {dados && <small>Atualizado em {dataHora(dados.geradoEm)}</small>}
        </div>
        <label className="campo" style={{ width: 180 }}>
          Período
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            {[7, 30, 60, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                Últimos {d} dias
              </option>
            ))}
          </select>
        </label>
      </div>
      {carregando && <Carregando />}
      <Aviso>{erro?.message}</Aviso>
      {dados && (
        <>
          <h2>Participação</h2>
          <div className="grade">
            <Kpi rotulo="Adesões no período" valor={dados.adesoesPeriodo} />
            <Kpi
              rotulo="Participantes ativos"
              valor={dados.participantesAtivos}
              detalhe={`${dados.participantesComCompra90d} compraram em 90 dias`}
            />
            <Kpi
              rotulo="Recompra 30 / 60 / 90 dias"
              valor={`${pct(dados.recompra.em30diasBps)} · ${pct(dados.recompra.em60diasBps)} · ${pct(dados.recompra.em90diasBps)}`}
              detalhe={`base: ${dados.recompra.baseCompradores} compradores`}
            />
            <Kpi
              rotulo="Ticket médio (participantes)"
              valor={brl(dados.ticketMedioCentavos)}
              detalhe={`${dados.vendasParticipantes} vendas`}
            />
            <Kpi
              rotulo="Vendas indicadas"
              valor={dados.vendasIndicadas.quantidade}
              detalhe={`${brl(dados.vendasIndicadas.valorCentavos)} · recompensas ${brl(dados.vendasIndicadas.recompensaCentavos)}`}
            />
          </div>
          <h2>Cashback no período</h2>
          <div className="grade">
            <Kpi rotulo="Emitido (clientes)" valor={brl(dados.cashback.emitidoCentavos)} />
            <Kpi
              rotulo="Recompensas (prestadores)"
              valor={brl(dados.cashback.recompensaEmitidaCentavos)}
            />
            <Kpi rotulo="Resgatado" valor={brl(dados.cashback.resgatadoCentavos)} />
            <Kpi rotulo="Vencido" valor={brl(dados.cashback.vencidoCentavos)} />
            <Kpi rotulo="Estornado" valor={brl(dados.cashback.estornadoCentavos)} />
          </div>
          <h2>Saldo em aberto (passivo)</h2>
          <div className="grade">
            <Kpi rotulo="Disponível para uso" valor={brl(dados.passivo.disponivelCentavos)} />
            <Kpi rotulo="Pendente (em carência)" valor={brl(dados.passivo.pendenteCentavos)} />
            <Kpi
              rotulo="Saldo devedor de clientes"
              valor={brl(dados.passivo.saldoDevedorCentavos)}
            />
          </div>
          <h2>Atenção</h2>
          <div className="grade">
            <Kpi
              rotulo="Alertas de margem"
              valor={dados.alertas.margemAbertos}
              detalhe={<Link href="/painel/importacao?aba=alertas">ver alertas</Link>}
            />
            <Kpi rotulo="Alertas abertos (todos)" valor={dados.alertas.abertos} />
            <Kpi
              rotulo="Divergências de conciliação"
              valor={dados.alertas.divergenciasAbertas}
              detalhe={<Link href="/painel/importacao?aba=divergencias">tratar</Link>}
            />
            <Kpi
              rotulo="Prestadores aguardando aprovação"
              valor={dados.alertas.prestadoresPendentes}
              detalhe={<Link href="/painel/prestadores">fila</Link>}
            />
          </div>
        </>
      )}
    </div>
  );
}
