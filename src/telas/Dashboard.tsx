// HospCheck — dashboard real com filtros e cartões clicáveis
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatarData, formatarMoeda, formatarPercentual, ErroApi } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, GraficoBarras, GraficoLinha, Layout, Metrica, Selo, Vazio, Icone } from '../componentes';

interface Resumo {
  periodo: { desde: string; ate: string };
  total_equipamentos: number;
  ativos_operacionais: number;
  restricoes: number;
  inspecoes: { em_dia: number; proximas: number; vencidas: number; nunca: number };
  calibracoes: { vencidas: number; proximas: number };
  manutencao: { programadas: number; em_andamento: number };
  ocorrencias: { abertas: number; criticas: number };
  interditados: number;
  gastos: { manutencao_centavos: number; calibracao_centavos: number; total_centavos: number };
  pontualidade_pct: number | null;
  inspecoes_no_periodo: number;
  inspecoes_atrasadas: number;
  por_setor: { setor: string; total: number; em_dia: number; vencidas: number; proximas: number }[];
  evolucao_gastos: { mes: string; manutencao_centavos: number; calibracao_centavos: number; total_centavos: number }[];
  maior_custo: { id: string; nome: string; codigo: string; manutencao_centavos: number; calibracao_centavos: number; total_centavos: number }[];
  alertas: { total: number; criticos: number; atencao: number };
  equipamentos: any[];
}

interface Opcoes { setores: { id: string; nome: string }[]; usuarios: { id: string; nome: string }[]; tipos: string[]; status: string[] }

export function TelaDashboard() {
  const navegar = useNavigate();
  const { usuario, dados_demo } = { usuario: usarSessao().usuario, dados_demo: null };
  const [dados, setDados] = useState<Resumo | null>(null);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtros, setFiltros] = useState({ desde: '', ate: '', setor_id: '', responsavel_id: '', status: '', situacao: '' });

  const hoje = useMemo(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), []);

  useEffect(() => {
    api.get<Opcoes>('/api/equipamentos/opcoes').then(setOpcoes).catch(() => setOpcoes({ setores: [], usuarios: [], tipos: [], status: [] }));
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = new URLSearchParams();
      Object.entries(filtros).forEach(([k, v]) => { if (v) p.set(k, v); });
      if (!filtros.desde && !filtros.ate) p.set('desde', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
      const r = await api.get<Resumo>('/api/dashboard' + (p.toString() ? `?${p}` : ''));
      setDados(r);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar o dashboard.');
    } finally {
      setCarregando(false);
    }
  }, [filtros]);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtrar = (extras: Record<string, string>) => {
    navegar(`/equipamentos?${new URLSearchParams(extras).toString()}`);
  };

  const dadosPorSetor = useMemo(() => (dados?.por_setor || []).map(s => ({
    rotulo: s.setor,
    segmentos: [
      { valor: s.vencidas, cor: '#C0392B', nome: 'Vencidas' },
      { valor: s.proximas, cor: '#9A5D05', nome: 'Próximas' },
      { valor: s.em_dia, cor: '#0F7360', nome: 'Em dia' }
    ]
  })), [dados]);

  // Segmentos e total permanecem em centavos: a conversão para BRL acontece uma única vez,
  // dentro de formatarMoeda (usada na barra e nos tooltips).
  const topoCusto = useMemo(() => (dados?.maior_custo || []).filter(m => m.total_centavos > 0).slice(0, 8).map(m => ({
    rotulo: m.codigo,
    segmentos: [
      { valor: m.calibracao_centavos, cor: '#0F7360', nome: 'Calibrações' },
      { valor: m.manutencao_centavos, cor: '#0B5CAB', nome: 'Manutenções' }
    ],
    total: m.total_centavos
  })), [dados]);

  const limparFiltros = () => setFiltros({ desde: '', ate: '', setor_id: '', responsavel_id: '', status: '', situacao: '' });
  const temFiltro = Object.values(filtros).some(Boolean);

  return (
    <Layout titulo="Painel">
      <EtiquetaDemo />

      <div className="cartao">
        <div className="cartao__titulo">
          <span><Icone nome="lupa" tam={17} /> Filtros</span>
          {temFiltro && <button className="botao botao--fantasma botao--pequeno" onClick={limparFiltros}>Limpar</button>}
        </div>
        <div className="grade-filtros">
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo" htmlFor="f-desde">Período — de</label>
            <input id="f-desde" className="entrada" type="date" value={filtros.desde}
              onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} />
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo" htmlFor="f-ate">Período — até</label>
            <input id="f-ate" className="entrada" type="date" value={filtros.ate}
              onChange={e => setFiltros(f => ({ ...f, ate: e.target.value }))} />
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo" htmlFor="f-setor">Setor</label>
            <select id="f-setor" className="seletor" value={filtros.setor_id}
              onChange={e => setFiltros(f => ({ ...f, setor_id: e.target.value }))}>
              <option value="">Todos os setores</option>
              {(opcoes?.setores || []).map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo" htmlFor="f-resp">Responsável</label>
            <select id="f-resp" className="seletor" value={filtros.responsavel_id}
              onChange={e => setFiltros(f => ({ ...f, responsavel_id: e.target.value }))}>
              <option value="">Todos</option>
              {(opcoes?.usuarios || []).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo" htmlFor="f-status">Status</label>
            <select id="f-status" className="seletor" value={filtros.status}
              onChange={e => setFiltros(f => ({ ...f, status: e.target.value }))}>
              <option value="">Todos</option>
              {(opcoes?.status || []).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="filtros" style={{ marginTop: 12, marginBottom: 0 }}>
          {[['', 'Situação: todas'], ['em_dia', 'Em dia'], ['proxima', 'Próximas'], ['vencida', 'Vencidas']].map(([v, r]) => (
            <button key={v} className={`filtro-pilula${filtros.situacao === v ? ' ativo' : ''}`}
              onClick={() => setFiltros(f => ({ ...f, situacao: v! }))}>{r}</button>
          ))}
        </div>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}

      {dados && (
        <>
          <div className="grade-cartoes">
            <Metrica valor={dados.total_equipamentos} rotulo="Equipamentos" cor="cinza"
              aoClicar={() => filtrar({})} titulo="Ver todos os equipamentos" />
            <Metrica valor={dados.inspecoes.em_dia} rotulo="Inspeções em dia" cor="verde"
              aoClicar={() => filtrar({ situacao: 'em_dia' })} />
            <Metrica valor={dados.inspecoes.proximas} rotulo="Próximas do vencimento" cor="laranja"
              aoClicar={() => filtrar({ situacao: 'proxima' })} />
            <Metrica valor={dados.inspecoes.vencidas} rotulo="Inspeções vencidas" cor="vermelho"
              aoClicar={() => filtrar({ situacao: 'vencida' })} />
            <Metrica valor={dados.calibracoes.vencidas} rotulo="Calibrações vencidas" cor="vermelho"
              aoClicar={() => navegar('/calibracoes?resultado=vencidas')} />
            <Metrica valor={dados.manutencao.programadas} rotulo="Manutenção programada" cor="laranja"
              aoClicar={() => navegar('/manutencoes')} />
            <Metrica valor={dados.interditados} rotulo="Interditados" cor="vermelho"
              aoClicar={() => filtrar({ status: 'interditado' })} />
            <Metrica valor={dados.ocorrencias.abertas} rotulo={`Ocorrências (${dados.ocorrencias.criticas} críticas)`} cor="laranja"
              aoClicar={() => navegar('/ocorrencias?status=aberta')} />
          </div>

          <div className="grade-cartoes">
            <Metrica valor={formatarMoeda(dados.gastos.manutencao_centavos)} rotulo="Gasto com manutenção no período" />
            <Metrica valor={formatarMoeda(dados.gastos.calibracao_centavos)} rotulo="Gasto com calibração no período" />
            <Metrica valor={formatarMoeda(dados.gastos.total_centavos)} rotulo="Gasto total no período" cor="verde"
              aoClicar={() => navegar('/relatorios?tipo=gastos')} />
            <Metrica valor={dados.pontualidade_pct === null ? '—' : formatarPercentual(dados.pontualidade_pct)}
              rotulo={`Pontualidade (${dados.inspecoes_no_periodo} insp., ${dados.inspecoes_atrasadas} atrasadas)`}
              cor={dados.pontualidade_pct !== null && dados.pontualidade_pct >= 80 ? 'verde' : 'laranja'} />
          </div>

          <div className="cartao">
            <div className="cartao__titulo">Inspeções por setor</div>
            <GraficoBarras dados={dadosPorSetor} />
            <p className="texto-pequeno" style={{ marginTop: 8 }}>
              <span style={{ color: '#C0392B', fontWeight: 700 }}>■</span> Vencidas ·
              <span style={{ color: '#9A5D05', fontWeight: 700 }}> ■</span> Próximas ·
              <span style={{ color: '#0F7360', fontWeight: 700 }}> ■</span> Em dia
            </p>
          </div>

          <div className="cartao">
            <div className="cartao__titulo">
              <span>Evolução dos gastos (12 meses)</span>
              <span className="texto-pequeno">{formatarMoeda(dados.evolucao_gastos.reduce((s, m) => s + m.total_centavos, 0))}</span>
            </div>
            <GraficoLinha dados={dados.evolucao_gastos} />
          </div>

          <div className="cartao">
            <div className="cartao__titulo">Equipamentos de maior custo</div>
            {topoCusto.length
              ? <><GraficoBarras dados={topoCusto} formatar={formatarMoeda} />
                  <p className="texto-pequeno" style={{ marginTop: 8 }}>
                    Valores em reais: <span style={{ color: '#0B5CAB', fontWeight: 700 }}>■</span> Manutenções ·
                    <span style={{ color: '#0F7360', fontWeight: 700 }}> ■</span> Calibrações
                  </p></>
              : <Vazio titulo="Sem gastos no período" />}
          </div>

          <div className="cartao">
            <div className="cartao__titulo">
              <span>Equipamentos exigindo atenção</span>
              <button className="botao botao--fantasma botao--pequeno" onClick={() => navegar('/equipamentos')}>Ver todos</button>
            </div>
            {dados.equipamentos.filter(e =>
              e.resumo?.inspeccao?.situacao === 'vencida' || e.status === 'interditado' ||
              e.resumo?.ocorrencias_abertas > 0).length === 0
              ? <Vazio titulo="Nenhum equipamento em alerta" />
              : <ul className="lista">
                  {dados.equipamentos.filter(e =>
                    e.resumo?.inspeccao?.situacao === 'vencida' || e.status === 'interditado' ||
                    e.resumo?.ocorrencias_abertas > 0).slice(0, 8).map(e => (
                    <li key={e.id}>
                      <a className="item-lista" href={`/equipamentos/${e.id}`}>
                        <div className="item-lista__topo">
                          <div style={{ minWidth: 0 }}>
                            <div className="item-lista__titulo">{e.nome}</div>
                            <div className="item-lista__sub">{e.codigo} · {e.setor_nome || 'Sem setor'}</div>
                          </div>
                          <Selo valor={e.status} />
                        </div>
                        <div className="item-lista__meta">
                          <span className={`selo selo--${e.resumo?.inspeccao?.situacao === 'vencida' ? 'vermelho' : e.resumo?.inspeccao?.situacao === 'proxima' ? 'laranja' : 'verde'}`}>
                            {e.resumo?.inspeccao?.rotulo}
                          </span>
                          {!!e.resumo?.ocorrencias_abertas && <span className="selo selo--laranja">{e.resumo.ocorrencias_abertas} ocorrência(s)</span>}
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>}
          </div>

          {dados.alertas.total > 0 && (
            <div className="acoes-linha">
              <button className="botao botao--verde botao--largura-total" onClick={() => navegar('/alertas')}>
                <Icone nome="alerta" tam={19} /> Abrir centro de alertas ({dados.alertas.total})
              </button>
            </div>
          )}

          <p className="texto-pequeno centralizado" style={{ marginTop: 14 }}>
            Período: {formatarData(dados.periodo.desde)} a {formatarData(dados.periodo.ate)} · fuso America/Sao_Paulo
          </p>
        </>
      )}
    </Layout>
  );
}
