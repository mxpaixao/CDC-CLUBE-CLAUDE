'use client';
import { Aviso, Carregando, SeloEstado, Vazio } from '@/componentes/basicos';
import { brl, data, dataHora } from '@/lib/formato';
import { useDados } from '@/lib/hooks';

interface Bonus {
  porEstado: { estado: string; tipo: string; quantidade: number; total: number }[];
  vencendo7dias: { id: string; carteiraId: string; venceEm: string; restante: number }[];
  reservasAbertas: {
    id: string;
    codigo: string;
    valorCentavos: number;
    lojaId: string;
    expiraEm: string;
  }[];
}

export default function BonusResgates() {
  const { dados, erro, carregando } = useDados<Bonus>('/relatorios/bonus-resgates');
  return (
    <div className="pilha">
      <h1>Bônus e resgates</h1>
      {carregando && <Carregando />}
      <Aviso>{erro?.message}</Aviso>
      {dados && (
        <>
          <section className="cartao tabela-rolagem">
            <h2>Créditos por estado (valor original dos lotes)</h2>
            <table>
              <thead>
                <tr>
                  <th>Carteira</th>
                  <th>Estado</th>
                  <th className="direita">Lotes</th>
                  <th className="direita">Valor</th>
                </tr>
              </thead>
              <tbody>
                {dados.porEstado.map((p) => (
                  <tr key={`${p.tipo}-${p.estado}`}>
                    <td>{p.tipo === 'PRESTADOR' ? 'Prestador' : 'Cliente'}</td>
                    <td>
                      <SeloEstado estado={p.estado} />
                    </td>
                    <td className="direita num">{p.quantidade}</td>
                    <td className="direita num">{brl(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="duas-colunas">
            <section className="cartao tabela-rolagem">
              <h2>Vencendo nos próximos 7 dias</h2>
              {dados.vencendo7dias.length === 0 ? (
                <Vazio>Nada vencendo.</Vazio>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Vence em</th>
                      <th>Carteira</th>
                      <th className="direita">Saldo do lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.vencendo7dias.map((v) => (
                      <tr key={v.id}>
                        <td>{data(v.venceEm)}</td>
                        <td className="mono">{v.carteiraId.slice(0, 8)}</td>
                        <td className="direita num">{brl(v.restante)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="cartao tabela-rolagem">
              <h2>Reservas abertas</h2>
              {dados.reservasAbertas.length === 0 ? (
                <Vazio>Nenhuma reserva aberta.</Vazio>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Loja</th>
                      <th className="direita">Valor</th>
                      <th>Expira</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.reservasAbertas.map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{r.codigo}</td>
                        <td>{r.lojaId}</td>
                        <td className="direita num">{brl(r.valorCentavos)}</td>
                        <td>{dataHora(r.expiraEm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
