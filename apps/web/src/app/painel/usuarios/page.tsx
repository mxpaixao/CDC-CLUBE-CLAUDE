'use client';
import { useState } from 'react';
import { Aviso, Carregando, Selo } from '@/componentes/basicos';
import { api } from '@/lib/api';
import { dataHora } from '@/lib/formato';
import { useAcao, useDados } from '@/lib/hooks';

interface Usuario {
  id: string;
  nome: string;
  email: string;
  permissoes: string[];
  lojaId: string | null;
  ativo: boolean;
  ultimoAcesso: string | null;
}
interface Registro {
  id: string;
  ator: string;
  usuarioId: string | null;
  acao: string;
  entidade: string;
  entidadeId: string | null;
  antes: unknown;
  depois: unknown;
  motivo: string | null;
  criadoEm: string;
}
interface Template {
  codigo: string;
  titulo: string;
  corpo: string;
  ativo: boolean;
}
const PERMISSOES = [
  'cadastro',
  'operacao_caixa',
  'alteracao_regras',
  'ajuste_saldo',
  'aprovacao_prestador',
  'visualizacao_relatorios',
  'admin',
];

export default function UsuariosAuditoria() {
  const [aba, setAba] = useState<'usuarios' | 'auditoria' | 'templates' | 'sistema'>('usuarios');
  return (
    <div className="pilha">
      <h1>Usuários e auditoria</h1>
      <div className="abas" role="tablist">
        {(['usuarios', 'auditoria', 'templates', 'sistema'] as const).map((a) => (
          <button key={a} role="tab" className={aba === a ? 'ativa' : ''} onClick={() => setAba(a)}>
            {
              {
                usuarios: 'Usuários e perfis',
                auditoria: 'Trilha de auditoria',
                templates: 'Mensagens',
                sistema: 'Sistema',
              }[a]
            }
          </button>
        ))}
      </div>
      {aba === 'usuarios' && <Usuarios />}
      {aba === 'auditoria' && <Auditoria />}
      {aba === 'templates' && <Templates />}
      {aba === 'sistema' && <Sistema />}
    </div>
  );
}

function Usuarios() {
  const lista = useDados<Usuario[]>('/usuarios');
  const lojas = useDados<{ id: string; nome: string }[]>('/lojas');
  const [f, setF] = useState({
    nome: '',
    email: '',
    senha: '',
    lojaId: '',
    permissoes: ['operacao_caixa'] as string[],
  });
  const acao = useAcao();
  const criar = () =>
    acao.executar(async () => {
      await api('/usuarios', { body: { ...f, lojaId: f.lojaId || null } });
      setF({ nome: '', email: '', senha: '', lojaId: '', permissoes: ['operacao_caixa'] });
      await lista.recarregar();
    });
  const alternarAtivo = (u: Usuario) =>
    acao.executar(async () => {
      await api(`/usuarios/${u.id}`, { method: 'PATCH', body: { ativo: !u.ativo } });
      await lista.recarregar();
    });
  const alternarPerm = (u: Usuario, p: string) =>
    acao.executar(async () => {
      const permissoes = u.permissoes.includes(p)
        ? u.permissoes.filter((x) => x !== p)
        : [...u.permissoes, p];
      if (!permissoes.length) throw new Error('usuário precisa de ao menos uma permissão');
      await api(`/usuarios/${u.id}`, { method: 'PATCH', body: { permissoes } });
      await lista.recarregar();
    });
  return (
    <div className="pilha">
      {lista.carregando && <Carregando />}
      <div className="cartao tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Loja</th>
              {PERMISSOES.map((p) => (
                <th key={p} title={p}>
                  {p.replace('_', ' ')}
                </th>
              ))}
              <th>Último acesso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.dados?.map((u) => (
              <tr key={u.id}>
                <td>{u.nome}</td>
                <td>{u.email}</td>
                <td>{u.lojaId ?? '—'}</td>
                {PERMISSOES.map((p) => (
                  <td key={p}>
                    <input
                      type="checkbox"
                      checked={u.permissoes.includes(p)}
                      onChange={() => void alternarPerm(u, p)}
                      aria-label={`${p} para ${u.nome}`}
                    />
                  </td>
                ))}
                <td>{dataHora(u.ultimoAcesso)}</td>
                <td>
                  <button
                    className={`botao pequeno ${u.ativo ? 'perigo' : ''}`}
                    onClick={() => void alternarAtivo(u)}
                  >
                    {u.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="cartao pilha"
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
      >
        <h2>Novo usuário</h2>
        <div className="grade">
          <label className="campo">
            Nome
            <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required />
          </label>
          <label className="campo">
            E-mail
            <input
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
              required
            />
          </label>
          <label className="campo">
            Senha inicial (mín. 10)
            <input
              type="password"
              value={f.senha}
              onChange={(e) => setF({ ...f, senha: e.target.value })}
              minLength={10}
              required
            />
          </label>
          <label className="campo">
            Loja
            <select value={f.lojaId} onChange={(e) => setF({ ...f, lojaId: e.target.value })}>
              <option value="">Todas</option>
              {lojas.dados?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="linha">
          {PERMISSOES.map((p) => (
            <label key={p} className="check">
              <input
                type="checkbox"
                checked={f.permissoes.includes(p)}
                onChange={(e) =>
                  setF({
                    ...f,
                    permissoes: e.target.checked
                      ? [...f.permissoes, p]
                      : f.permissoes.filter((x) => x !== p),
                  })
                }
              />
              {p}
            </label>
          ))}
        </div>
        <button className="botao" disabled={acao.enviando}>
          Criar usuário
        </button>
      </form>
      <Aviso>{acao.erro}</Aviso>
    </div>
  );
}

function Auditoria() {
  const [filtro, setFiltro] = useState({ acao: '', entidade: '', entidadeId: '' });
  const [aplicado, setAplicado] = useState(filtro);
  const q = new URLSearchParams(Object.entries(aplicado).filter(([, v]) => v)).toString();
  const lista = useDados<Registro[]>(`/auditoria${q ? `?${q}` : ''}`);
  return (
    <div className="pilha">
      <form
        className="cartao linha"
        onSubmit={(e) => {
          e.preventDefault();
          setAplicado(filtro);
        }}
      >
        <input
          placeholder="Ação (ex.: AJUSTE_SALDO)"
          value={filtro.acao}
          onChange={(e) => setFiltro({ ...filtro, acao: e.target.value.toUpperCase() })}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Entidade (ex.: Regra, Carteira)"
          value={filtro.entidade}
          onChange={(e) => setFiltro({ ...filtro, entidade: e.target.value })}
          style={{ flex: 1 }}
        />
        <input
          placeholder="ID da entidade"
          value={filtro.entidadeId}
          onChange={(e) => setFiltro({ ...filtro, entidadeId: e.target.value })}
          style={{ flex: 1 }}
        />
        <button className="botao">Filtrar</button>
      </form>
      {lista.carregando && <Carregando />}
      <div className="cartao tabela-rolagem">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Ator</th>
              <th>Ação</th>
              <th>Entidade</th>
              <th>Motivo</th>
              <th>Antes → depois</th>
            </tr>
          </thead>
          <tbody>
            {lista.dados?.map((r) => (
              <tr key={r.id}>
                <td>{dataHora(r.criadoEm)}</td>
                <td>
                  <Selo>{r.ator}</Selo>{' '}
                  <span className="mono suave">{r.usuarioId?.slice(0, 8)}</span>
                </td>
                <td className="mono">{r.acao}</td>
                <td>
                  {r.entidade} <span className="mono suave">{r.entidadeId?.slice(0, 8)}</span>
                </td>
                <td>{r.motivo ?? '—'}</td>
                <td>
                  <details>
                    <summary className="suave">ver</summary>
                    <pre
                      className="mono"
                      style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap', maxWidth: 420 }}
                    >
                      {JSON.stringify({ antes: r.antes, depois: r.depois }, null, 2)}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Templates() {
  const lista = useDados<Template[]>('/notificacoes/templates');
  const acao = useAcao();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const salvar = (t: Template) =>
    acao.executar(async () => {
      await api(`/notificacoes/templates/${t.codigo}`, {
        method: 'PATCH',
        body: { corpo: edits[t.codigo] ?? t.corpo },
      });
      await lista.recarregar();
    });
  return (
    <div className="pilha">
      <p className="suave">
        Variáveis entre chaves duplas, ex.: {'{{valor}}'}, {'{{dias}}'}, {'{{codigo}}'}. Envio
        respeita consentimento por canal e horário comercial de Manaus.
      </p>
      {lista.dados?.map((t) => (
        <div key={t.codigo} className="cartao pilha">
          <div className="linha entre">
            <strong>{t.titulo}</strong>
            <span className="mono suave">{t.codigo}</span>
          </div>
          <textarea
            rows={3}
            style={{ fontFamily: 'var(--fonte)', minHeight: 72 }}
            value={edits[t.codigo] ?? t.corpo}
            onChange={(e) => setEdits({ ...edits, [t.codigo]: e.target.value })}
          />
          <button
            className="botao secundario pequeno"
            onClick={() => void salvar(t)}
            disabled={acao.enviando}
          >
            Salvar
          </button>
        </div>
      ))}
      <Aviso>{acao.erro}</Aviso>
    </div>
  );
}

function Sistema() {
  const cont = useDados<{ ativa: boolean; motivo: string | null; desde: string | null }>(
    '/sistema/contingencia',
  );
  const acao = useAcao();
  const [resultado, setResultado] = useState<string | null>(null);
  const alternar = () =>
    acao.executar(async () => {
      const motivo = window.prompt(
        cont.dados?.ativa
          ? 'Por que encerrar a contingência? (o que foi verificado)'
          : 'Motivo da contingência:',
      );
      if (!motivo) return;
      await api('/sistema/contingencia', {
        method: 'PUT',
        body: { ativa: !cont.dados?.ativa, motivo },
      });
      await cont.recarregar();
    });
  const job = (nome: string) =>
    acao.executar(async () =>
      setResultado(`${nome}: ${JSON.stringify(await api(`/jobs/${nome}`, { body: {} }))}`),
    );
  return (
    <div className="pilha">
      <div className="cartao pilha">
        <h2>Contingência da integração</h2>
        {cont.dados?.ativa ? (
          <Aviso tipo="alerta">
            Ativa desde {dataHora(cont.dados.desde)} — {cont.dados.motivo}
          </Aviso>
        ) : (
          <Aviso tipo="ok">Operação normal.</Aviso>
        )}
        <button
          className={`botao ${cont.dados?.ativa ? '' : 'perigo'}`}
          onClick={() => void alternar()}
        >
          {cont.dados?.ativa ? 'Encerrar contingência' : 'Ativar contingência'}
        </button>
      </div>
      <div className="cartao pilha">
        <h2>Executar job manualmente</h2>
        <div className="linha">
          {[
            'liberar-creditos',
            'vencer-creditos',
            'expirar-reservas',
            'lembretes',
            'enviar-notificacoes',
            'conciliacao',
            'importar-pasta',
            'antifraude',
            'niveis-prestador',
          ].map((j) => (
            <button
              key={j}
              className="botao secundario pequeno"
              onClick={() => void job(j)}
              disabled={acao.enviando}
            >
              {j}
            </button>
          ))}
        </div>
        {resultado && (
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
            {resultado}
          </pre>
        )}
      </div>
      <Aviso>{acao.erro}</Aviso>
    </div>
  );
}
