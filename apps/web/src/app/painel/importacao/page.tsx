'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Aviso, Carregando, Selo, Vazio } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { brl, dataHora } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';
import { pode, useUsuario } from '@/lib/painel';

interface Importacao {
  id: string;
  arquivoNome: string;
  origem: string;
  status: string;
  linhasTotal: number;
  linhasOk: number;
  linhasIgnoradas: number;
  linhasErro: number;
  erros: { linha: number; documento?: string; erro: string }[] | null;
  resumo: {
    vendasNovas: number;
    vendasRepetidas: number;
    devolucoes: number;
    cashbackCentavos: number;
    recompensaCentavos: number;
    arquivoJaImportadoEm: string | null;
  } | null;
  iniciadaEm: string;
}
interface Divergencia {
  id: string;
  tipo: string;
  severidade: string;
  descricao: string;
  status: string;
  resolucao: string | null;
  criadoEm: string;
}
interface Alerta {
  id: string;
  tipo: string;
  severidade: string;
  descricao: string;
  status: string;
  criadoEm: string;
}
interface Mapeamento {
  id: string;
  nome: string;
  padrao: boolean;
  colunas: Record<string, string>;
  formatoData: string;
  separadorDecimal: string;
  delimitadorCsv: string;
}
const COR_STATUS: Record<string, string> = {
  CONCLUIDA: 'ok',
  CONCLUIDA_COM_ERROS: 'alerta',
  FALHOU: 'erro',
  PROCESSANDO: 'info',
  ABERTA: 'alerta',
  RESOLVIDA: 'ok',
  IGNORADA: '',
  ABERTO: 'alerta',
  ANALISADO: 'ok',
  DESCARTADO: '',
};

function Pagina() {
  const inicial =
    (useSearchParams().get('aba') as 'importar' | 'divergencias' | 'alertas' | 'mapeamentos') ??
    'importar';
  const [aba, setAba] = useState(inicial);
  return (
    <div className="pilha">
      <h1>Importação e conciliação</h1>
      <div className="abas" role="tablist">
        {(['importar', 'divergencias', 'alertas', 'mapeamentos'] as const).map((a) => (
          <button key={a} role="tab" className={aba === a ? 'ativa' : ''} onClick={() => setAba(a)}>
            {
              {
                importar: 'Importar arquivos do ERP',
                divergencias: 'Divergências',
                alertas: 'Alertas (antifraude, margem, teto)',
                mapeamentos: 'Mapeamento de colunas',
              }[a]
            }
          </button>
        ))}
      </div>
      {aba === 'importar' && <Importar />}
      {aba === 'divergencias' && <Divergencias />}
      {aba === 'alertas' && <Alertas />}
      {aba === 'mapeamentos' && <Mapeamentos />}
    </div>
  );
}

function Importar() {
  const historico = useDados<Importacao[]>('/importacoes');
  const mapeamentos = useDados<Mapeamento[]>('/importacoes/mapeamentos');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mapeamento, setMapeamento] = useState('');
  const [aberta, setAberta] = useState<Importacao | null>(null);
  const acao = useAcao();
  const enviar = () =>
    acao.executar(async () => {
      const form = new FormData();
      form.append('arquivo', arquivo!);
      if (mapeamento) form.append('mapeamentoId', mapeamento);
      setAberta(await api<Importacao>('/importacoes', { form }));
      setArquivo(null);
      await historico.recarregar();
    });
  return (
    <div className="pilha">
      <form
        className="cartao pilha"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <p className="suave">
          Arquivo CSV ou XLSX exportado do ERP (vendas, itens, pagamentos com cashback, devoluções e
          cancelamentos). Reimportar o mesmo arquivo é seguro: nada é duplicado. Layout em{' '}
          <span className="mono">docs/LAYOUT_IMPORTACAO.md</span>. A pasta monitorada no servidor é
          processada a cada 5 minutos.
        </p>
        <div className="grade">
          <label className="campo">
            Arquivo
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              required
            />
          </label>
          <label className="campo">
            Mapeamento
            <select value={mapeamento} onChange={(e) => setMapeamento(e.target.value)}>
              <option value="">Padrão</option>
              {mapeamentos.dados?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="botao" disabled={acao.enviando || !arquivo}>
          {acao.enviando ? 'Processando…' : 'Importar'}
        </button>
        <Aviso>{acao.erro}</Aviso>
      </form>
      {aberta && <ResultadoImportacao i={aberta} />}
      <section className="cartao tabela-rolagem">
        <h2>Histórico</h2>
        {historico.carregando && <Carregando />}
        {historico.dados?.length === 0 && <Vazio>Nenhuma importação.</Vazio>}
        {!!historico.dados?.length && (
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Arquivo</th>
                <th>Origem</th>
                <th>Status</th>
                <th className="direita">Linhas OK</th>
                <th className="direita">Repetidas</th>
                <th className="direita">Erros</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {historico.dados.map((i) => (
                <tr key={i.id}>
                  <td>{dataHora(i.iniciadaEm)}</td>
                  <td>{i.arquivoNome}</td>
                  <td>{i.origem}</td>
                  <td>
                    <Selo tipo={COR_STATUS[i.status]}>{i.status}</Selo>
                  </td>
                  <td className="direita num">{i.linhasOk}</td>
                  <td className="direita num">{i.linhasIgnoradas}</td>
                  <td className="direita num">{i.linhasErro}</td>
                  <td>
                    <button className="botao secundario pequeno" onClick={() => setAberta(i)}>
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ResultadoImportacao({ i }: { i: Importacao }) {
  return (
    <section className="cartao pilha">
      <div className="linha entre">
        <h2>{i.arquivoNome}</h2>
        <Selo tipo={COR_STATUS[i.status]}>{i.status}</Selo>
      </div>
      {i.resumo && (
        <p>
          {i.resumo.vendasNovas} vendas novas · {i.resumo.vendasRepetidas} já importadas ·{' '}
          {i.resumo.devolucoes} devoluções · cashback {brl(i.resumo.cashbackCentavos)} · recompensas{' '}
          {brl(i.resumo.recompensaCentavos)}
        </p>
      )}
      {i.resumo?.arquivoJaImportadoEm && (
        <Aviso tipo="info">
          Este mesmo arquivo já tinha sido importado em {dataHora(i.resumo.arquivoJaImportadoEm)} —
          nada foi duplicado.
        </Aviso>
      )}
      {!!i.erros?.length && (
        <div className="tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Linha</th>
                <th>Documento</th>
                <th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {i.erros.slice(0, 200).map((e, n) => (
                <tr key={n}>
                  <td>{e.linha}</td>
                  <td>{e.documento ?? '—'}</td>
                  <td>{e.erro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Divergencias() {
  const [status, setStatus] = useState('ABERTA');
  const lista = useDados<Divergencia[]>(`/conciliacao/divergencias?status=${status}`);
  const acao = useAcao();
  const executar = () =>
    acao.executar(async () => {
      await api('/conciliacao/executar', { body: {} });
      await lista.recarregar();
    });
  const tratar = (d: Divergencia, novo: 'RESOLVIDA' | 'IGNORADA') =>
    acao.executar(async () => {
      const resolucao = window.prompt(
        `Como foi ${novo === 'RESOLVIDA' ? 'resolvida' : 'ignorada'}?`,
      );
      if (!resolucao) return;
      await api(`/conciliacao/divergencias/${d.id}`, {
        method: 'PATCH',
        body: { status: novo, resolucao },
      });
      await lista.recarregar();
    });
  return (
    <div className="pilha">
      <div className="linha entre">
        <div className="linha">
          {['ABERTA', 'RESOLVIDA', 'IGNORADA'].map((s) => (
            <button
              key={s}
              className={`botao pequeno ${status === s ? '' : 'secundario'}`}
              onClick={() => setStatus(s)}
            >
              {s.toLowerCase()}
            </button>
          ))}
        </div>
        <button
          className="botao secundario"
          onClick={() => void executar()}
          disabled={acao.enviando}
        >
          Executar conciliação agora
        </button>
      </div>
      <Aviso>{acao.erro}</Aviso>
      {lista.carregando && <Carregando />}
      {lista.dados?.length === 0 && <Vazio>Nenhuma divergência {status.toLowerCase()}.</Vazio>}
      {!!lista.dados?.length && (
        <div className="cartao tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Severidade</th>
                <th>Descrição</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((d) => (
                <tr key={d.id}>
                  <td>{dataHora(d.criadoEm)}</td>
                  <td className="mono">{d.tipo}</td>
                  <td>
                    <Selo tipo={d.severidade === 'ALTA' ? 'erro' : 'alerta'}>{d.severidade}</Selo>
                  </td>
                  <td>
                    {d.descricao}
                    {d.resolucao && <div className="suave">→ {d.resolucao}</div>}
                  </td>
                  <td>
                    <Selo tipo={COR_STATUS[d.status]}>{d.status}</Selo>
                  </td>
                  <td>
                    {d.status === 'ABERTA' && (
                      <div className="linha">
                        <button
                          className="botao pequeno"
                          onClick={() => void tratar(d, 'RESOLVIDA')}
                        >
                          Resolver
                        </button>
                        <button
                          className="botao secundario pequeno"
                          onClick={() => void tratar(d, 'IGNORADA')}
                        >
                          Ignorar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Alertas() {
  const [status, setStatus] = useState('ABERTO');
  const lista = useDados<Alerta[]>(`/alertas?status=${status}`);
  const acao = useAcao();
  const mudar = (a: Alerta, novo: string) =>
    acao.executar(async () => {
      await api(`/alertas/${a.id}`, { method: 'PATCH', body: { status: novo } });
      await lista.recarregar();
    });
  return (
    <div className="pilha">
      <div className="linha">
        {['ABERTO', 'ANALISADO', 'DESCARTADO'].map((s) => (
          <button
            key={s}
            className={`botao pequeno ${status === s ? '' : 'secundario'}`}
            onClick={() => setStatus(s)}
          >
            {s.toLowerCase()}
          </button>
        ))}
      </div>
      {lista.carregando && <Carregando />}
      {lista.dados?.length === 0 && <Vazio>Nenhum alerta {status.toLowerCase()}.</Vazio>}
      {!!lista.dados?.length && (
        <div className="cartao tabela-rolagem">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Severidade</th>
                <th>Descrição</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((a) => (
                <tr key={a.id}>
                  <td>{dataHora(a.criadoEm)}</td>
                  <td className="mono">{a.tipo}</td>
                  <td>
                    <Selo tipo={a.severidade === 'ALTA' ? 'erro' : 'alerta'}>{a.severidade}</Selo>
                  </td>
                  <td>{a.descricao}</td>
                  <td>
                    {a.status === 'ABERTO' && (
                      <div className="linha">
                        <button
                          className="botao pequeno"
                          onClick={() => void mudar(a, 'ANALISADO')}
                        >
                          Analisado
                        </button>
                        <button
                          className="botao secundario pequeno"
                          onClick={() => void mudar(a, 'DESCARTADO')}
                        >
                          Descartar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Aviso>{acao.erro}</Aviso>
    </div>
  );
}

function Mapeamentos() {
  const usuario = useUsuario();
  const lista = useDados<Mapeamento[]>('/importacoes/mapeamentos');
  const [edit, setEdit] = useState<Mapeamento | null>(null);
  const [json, setJson] = useState('');
  const acao = useAcao();
  const abrir = (m: Mapeamento) => {
    setEdit(m);
    setJson(JSON.stringify(m.colunas, null, 2));
  };
  const salvar = () =>
    acao.executar(async () => {
      const colunas = JSON.parse(json);
      const corpo = {
        nome: edit!.nome,
        colunas,
        formatoData: edit!.formatoData,
        separadorDecimal: edit!.separadorDecimal,
        delimitadorCsv: edit!.delimitadorCsv,
        padrao: edit!.padrao,
      };
      if (edit!.id)
        await api(`/importacoes/mapeamentos/${edit!.id}`, { method: 'PUT', body: corpo });
      else await api('/importacoes/mapeamentos', { body: corpo });
      setEdit(null);
      await lista.recarregar();
    });
  return (
    <div className="pilha">
      <p className="suave">
        Liga cada campo interno ao nome da coluna no arquivo do ERP. Assim, mudanças no relatório do
        ERP não exigem alteração de código.
      </p>
      {lista.dados?.map((m) => (
        <div key={m.id} className="cartao linha entre">
          <div>
            <strong>{m.nome}</strong> {m.padrao && <Selo tipo="ok">padrão</Selo>}
            <div className="suave">
              data {m.formatoData} · decimal {m.separadorDecimal} · separador “{m.delimitadorCsv}”
            </div>
          </div>
          {pode(usuario, 'admin') && (
            <button className="botao secundario pequeno" onClick={() => abrir(m)}>
              Editar
            </button>
          )}
        </div>
      ))}
      {pode(usuario, 'admin') && !edit && lista.dados?.[0] && (
        <button
          className="botao secundario"
          onClick={() =>
            abrir({ ...lista.dados![0], id: '', nome: 'Novo mapeamento', padrao: false })
          }
        >
          Novo mapeamento (a partir do padrão)
        </button>
      )}
      {edit && (
        <form
          className="cartao pilha"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <div className="grade">
            <label className="campo">
              Nome
              <input
                value={edit.nome}
                onChange={(e) => setEdit({ ...edit, nome: e.target.value })}
              />
            </label>
            <label className="campo">
              Formato de data
              <input
                value={edit.formatoData}
                onChange={(e) => setEdit({ ...edit, formatoData: e.target.value })}
              />
            </label>
            <label className="campo">
              Decimal
              <select
                value={edit.separadorDecimal}
                onChange={(e) => setEdit({ ...edit, separadorDecimal: e.target.value })}
              >
                <option value="virgula">vírgula (1.234,56)</option>
                <option value="ponto">ponto (1,234.56)</option>
              </select>
            </label>
            <label className="campo">
              Separador CSV
              <input
                maxLength={1}
                value={edit.delimitadorCsv}
                onChange={(e) => setEdit({ ...edit, delimitadorCsv: e.target.value })}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={edit.padrao}
              onChange={(e) => setEdit({ ...edit, padrao: e.target.checked })}
            />
            Usar como padrão
          </label>
          <label className="campo">
            Colunas: {'{'} campo interno: &quot;coluna no arquivo&quot; {'}'}
            <textarea
              rows={14}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="linha">
            <button className="botao" disabled={acao.enviando}>
              Salvar
            </button>
            <button type="button" className="botao secundario" onClick={() => setEdit(null)}>
              Cancelar
            </button>
          </div>
          <Aviso>{acao.erro}</Aviso>
        </form>
      )}
    </div>
  );
}

export default function ImportacaoConciliacao() {
  return (
    <Suspense>
      <Pagina />
    </Suspense>
  );
}
