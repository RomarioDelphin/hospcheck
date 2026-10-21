// HospCheck — lista de equipamentos com busca e filtros
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ErroApi } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Icone, Layout, Selo, Vazio } from '../componentes';

interface EquipamentoLista {
  id: string; codigo: string; nome: string; tipo: string; status: string; periodicidade: string;
  setor_nome?: string; localizacao?: string; responsavel_nome?: string;
  /** GET /api/equipamentos devolve o resumo em `situacao` (a dashboard usa `resumo`). */
  situacao: {
    inspeccao: { rotulo: string; situacao: string; atraso_dias: number; proxima: string };
    calibracao: { rotulo: string; situacao: string; proxima: string };
    ocorrencias_abertas: number;
  };
}

export function TelaEquipamentos() {
  const { pode } = usarSessao();
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<EquipamentoLista[]>([]);
  const [opcoes, setOpcoes] = useState<any>({ setores: [], usuarios: [], tipos: [], status: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState(params.get('busca') || '');
  const [setor, setSetor] = useState(params.get('setor_id') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [situacao, setSituacao] = useState(params.get('situacao') || '');

  useEffect(() => { api.get('/api/equipamentos/opcoes').then(setOpcoes).catch(() => {}); }, []);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const p = new URLSearchParams();
      if (busca) p.set('busca', busca);
      if (setor) p.set('setor_id', setor);
      if (status) p.set('status', status);
      // O servidor também filtra por situação de inspeção (em_dia | proxima | vencida).
      if (situacao) p.set('situacao', situacao);
      setLista(await api.get<EquipamentoLista[]>('/api/equipamentos' + (p.toString() ? `?${p}` : '')));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.');
    } finally { setCarregando(false); }
  }, [busca, setor, status, situacao]);

  useEffect(() => { const t = setTimeout(() => void carregar(), busca ? 280 : 0); return () => clearTimeout(t); }, [carregar, busca]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (busca) p.set('busca', busca);
    if (setor) p.set('setor_id', setor);
    if (status) p.set('status', status);
    if (situacao) p.set('situacao', situacao);
    setParams(p, { replace: true });
  }, [busca, setor, status, situacao, setParams]);

  const filtrada = useMemo(() =>
    situacao ? lista.filter(e => e.situacao?.inspeccao?.situacao === situacao) : lista,
    [lista, situacao]);

  return (
    <Layout titulo="Equipamentos">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="cartao">
        <div className="campo" style={{ marginBottom: 10 }}>
          <label className="campo__rotulo" htmlFor="busca">Buscar</label>
          <input id="busca" className="entrada" type="search" placeholder="Nome, código, série ou patrimônio"
            value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <div className="grade-filtros">
          <select className="seletor" aria-label="Filtrar por setor" value={setor} onChange={e => setSetor(e.target.value)}>
            <option value="">Todos os setores</option>
            {opcoes.setores.map((s: any) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <select className="seletor" aria-label="Filtrar por status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Todos os status</option>
            {opcoes.status.map((s: string) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="filtros" style={{ marginTop: 10, marginBottom: 0 }}>
          {[['', 'Todas'], ['em_dia', 'Em dia'], ['proxima', 'Próximas'], ['vencida', 'Vencidas']].map(([v, r]) => (
            <button key={v} className={`filtro-pilula${situacao === v ? ' ativo' : ''}`}
              onClick={() => setSituacao(v!)}>{r}</button>
          ))}
        </div>
      </div>

      {pode('equipamento.criar') && (
        <div className="acoes-linha" style={{ marginBottom: 12 }}>
          <Link to="/equipamentos/novo" className="botao botao--verde">
            <Icone nome="adicionar" tam={19} /> Novo equipamento
          </Link>
        </div>
      )}

      {carregando && <Carregando />}

      {!carregando && filtrada.length === 0 && (
        <Vazio titulo="Nenhum equipamento encontrado"
          acao={<Link to="/equipamentos/novo" className="botao botao--verde">Cadastrar equipamento</Link>}>
          Ajuste os filtros ou cadastre o primeiro equipamento do hospital.
        </Vazio>
      )}

      <ul className="lista">
        {filtrada.map(e => (
          <li key={e.id}>
            <Link className="item-lista" to={`/equipamentos/${e.id}`}>
              <div className="item-lista__topo">
                <div style={{ minWidth: 0 }}>
                  <div className="item-lista__titulo">{e.nome}</div>
                  <div className="item-lista__sub">{e.codigo} · {e.tipo}</div>
                </div>
                <Selo valor={e.status} />
              </div>
              <div className="item-lista__sub" style={{ marginTop: 6 }}>
                {e.setor_nome || 'Sem setor'}{e.localizacao ? ` — ${e.localizacao}` : ''}
                {e.responsavel_nome ? ` · Resp.: ${e.responsavel_nome}` : ''}
              </div>
              <div className="item-lista__meta">
                <span className={`selo selo--${e.situacao?.inspeccao?.situacao === 'vencida' ? 'vermelho'
                  : e.situacao?.inspeccao?.situacao === 'proxima' ? 'laranja' : 'verde'}`}>
                  Inspeção: {e.situacao?.inspeccao?.rotulo}
                </span>
                <span className={`selo selo--${e.situacao?.calibracao?.situacao === 'vencida' ? 'vermelho'
                  : e.situacao?.calibracao?.situacao === 'proxima' ? 'laranja' : 'cinza'}`}>
                  {e.situacao?.calibracao?.rotulo}
                </span>
                {!!e.situacao?.ocorrencias_abertas &&
                  <span className="selo selo--laranja">{e.situacao.ocorrencias_abertas} ocorrência(s)</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {!carregando && filtrada.length > 0 &&
        <p className="texto-pequeno centralizado">{filtrada.length} equipamento(s) listado(s)</p>}
    </Layout>
  );
}
