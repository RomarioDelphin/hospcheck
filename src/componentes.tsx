// HospCheck — componentes compartilhados: layout, navegação, selos, métricas, gráficos, modal
import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { usarSessao } from './sessao';
import { api, formatarMoeda, formatarPercentual, type Perfil } from './api';

// ---------- Ícones (SVG inline, sem dependência externa) ----------
export const Icone = ({ nome, tam = 22 }: { nome: string; tam?: number }) => {
  const p: Record<string, React.ReactNode> = {
    inicio: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
    equipamento: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    escanear: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M4 12h16" /></>,
    alerta: <><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17.5v.5" /></>,
    mais: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
    manutencao: <><path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-2-2 8-8" /><path d="M3 21l6-6M9.5 9.5 6 6l-3 3 3.5 3.5" /></>,
    calibracao: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></>,
    ocorrencia: <><path d="M4 5h16v11H8l-4 4z" /><path d="M12 8.5v3M12 13.5v.5" /></>,
    relatorio: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
    config: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2" /></>,
    camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></>,
    lupa: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    voltar: <><path d="M15 5l-7 7 7 7" /></>,
    check: <path d="m4.5 12.5 5 5 10-11" />,
    adicionar: <><path d="M12 5v14M5 12h14" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 18v3" /></>,
    saida: <><path d="M10 4H5v16h5" /><path d="M15 8l4 4-4 4M19 12H9" /></>,
    imagem: <><rect x="3" y="4" width="18" height="14" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="m4 17 5-4 4 3 3-2 4 3" /></>,
    download: <><path d="M12 3v11M8 11l4 4 4-4" /><path d="M4 19h16" /></>,
    setor: <><path d="M4 21V8l6-4 6 4v13" /><path d="M16 21V11l4 2v8M8 12h4M8 16h4" /></>,
    usuario: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
    cadeado: <><rect x="4.5" y="10" width="15" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    nuvem: <><path d="M7 18a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17.5 18z" /></>
  };
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p[nome] || p.equipamento}
    </svg>
  );
};

export const Marca = ({ tam = 26 }: { tam?: number }) => (
  <svg width={tam} height={tam} viewBox="0 0 192 192" aria-hidden="true">
    <rect width="192" height="192" rx="42" fill="#0B5CAB" />
    <path d="M96 34l52 22v38c0 32-21 58-52 66-31-8-52-34-52-66V56z" fill="#12856B" />
    <rect x="86" y="66" width="20" height="60" rx="6" fill="#fff" />
    <rect x="66" y="86" width="60" height="20" rx="6" fill="#fff" />
  </svg>
);

// ---------- Selo de status ----------
const CORES_STATUS: Record<string, string> = {
  operacional: 'verde', restricao: 'laranja', interditado: 'vermelho',
  manutencao: 'amarelo', desativado: 'cinza',
  conforme: 'verde', nao_conforme: 'vermelho', nao_se_aplica: 'cinza',
  rascunho: 'amarelo', concluida: 'verde', retificada: 'azul',
  aberta: 'vermelho', em_andamento: 'laranja', resolvida: 'verde', cancelada: 'cinza',
  baixa: 'cinza', media: 'amarelo', alta: 'laranja', critica: 'vermelho',
  preventiva: 'azul', corretiva: 'laranja',
  aprovada: 'verde', reprovada: 'vermelho', condicional: 'laranja',
  em_dia: 'verde', proxima: 'laranja', vencida: 'vermelho', nunca: 'cinza',
  sem_registro: 'cinza', sem_programacao: 'cinza', programada: 'azul'
};

export const rotuloStatus = (s: string): string => ({
  operacional: 'Operacional', restricao: 'Com restrição', interditado: 'Interditado',
  manutencao: 'Em manutenção', desativado: 'Desativado',
  conforme: 'Conforme', nao_conforme: 'Não conforme', nao_se_aplica: 'Não se aplica',
  rascunho: 'Rascunho', concluida: 'Concluída', retificada: 'Retificada',
  aberta: 'Aberta', em_andamento: 'Em andamento', resolvida: 'Resolvida', cancelada: 'Cancelada',
  baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'CRÍTICA',
  preventiva: 'Preventiva', corretiva: 'Corretiva',
  aprovada: 'Aprovada', reprovada: 'Reprovada', condicional: 'Condicional',
  em_dia: 'Em dia', proxima: 'Próxima', vencida: 'Vencida', nunca: 'Nunca inspecionado',
  sem_registro: 'Sem registro', sem_programacao: 'Sem programação', programada: 'Programada'
}[s] || s);

export const Selo = ({ valor, texto, tamanho = '' }: { valor: string; texto?: string; tamanho?: string }) => (
  <span className={`selo selo--${CORES_STATUS[valor] || 'cinza'}${tamanho ? ` selo--${tamanho}` : ''}`}>
    {texto || rotuloStatus(valor)}
  </span>
);

// ---------- Cartão de métrica clicável ----------
export const Metrica = ({ valor, rotulo, cor = '', aoClicar, titulo }:
  { valor: React.ReactNode; rotulo: string; cor?: string; aoClicar?: () => void; titulo?: string }) => {
  const classe = `metrica ${cor ? `metrica--${cor}` : ''}${aoClicar ? ' metrica--clicavel' : ''}`;
  const conteudo = (<>
    <span className="metrica__valor destaque-numerico">{valor}</span>
    <span className="metrica__rotulo">{rotulo}</span>
  </>);
  if (aoClicar) return <button type="button" className={classe} onClick={aoClicar} title={titulo || rotulo}>{conteudo}</button>;
  return <div className={classe}>{conteudo}</div>;
};

// ---------- Modal ----------
export const Modal = ({ aberto, aoFechar, titulo, children }:
  { aberto: boolean; aoFechar: () => void; titulo: string; children: React.ReactNode }) => {
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', aoTeclar);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', aoTeclar); document.body.style.overflow = ''; };
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return (
    <div className="fundo-modal" onClick={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal__cabecalho">
          <h2 style={{ margin: 0 }}>{titulo}</h2>
          <button type="button" className="modal__fechar" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ---------- Avisos ----------
export const Aviso = ({ tipo = 'info', titulo, children }:
  { tipo?: string; titulo?: string; children: React.ReactNode }) => (
  <div className={`aviso aviso--${tipo}`} role={tipo === 'erro' ? 'alert' : undefined}>
    {titulo && <strong>{titulo}</strong>}
    {children}
  </div>
);

export const Vazio = ({ titulo, children, acao }: { titulo: string; children?: React.ReactNode; acao?: React.ReactNode }) => (
  <div className="vazio">
    <strong>{titulo}</strong>
    {children}
    {acao && <div style={{ marginTop: 12 }}>{acao}</div>}
  </div>
);

export const Carregando = ({ texto = 'Carregando…' }: { texto?: string }) => (
  <div className="carregando" role="status">{texto}</div>
);

// ---------- Gráfico de barras (SVG-free, CSS) ----------
export const GraficoBarras = ({ dados, formatar }:
  { dados: { rotulo: string; segmentos: { valor: number; cor: string; nome?: string }[]; total?: number }[];
    formatar?: (valor: number) => string }) => {
  const texto = (v: number) => (formatar ? formatar(v) : String(v));
  const maximo = Math.max(1, ...dados.map(d => d.segmentos.reduce((s, x) => s + x.valor, 0)));
  if (!dados.length) return <Vazio titulo="Sem dados no período" />;
  return (
    <div className="grafico-barras">
      {dados.map((d, i) => {
        const total = d.total ?? d.segmentos.reduce((s, x) => s + x.valor, 0);
        const detalhe = d.segmentos.map(s => `${s.nome || 'Valor'}: ${texto(s.valor)}`).join(' • ');
        return (
          <div className="barra-linha" key={i}>
            <span className="barra-linha__rotulo" title={d.rotulo}>{d.rotulo}</span>
            <div className="barra-trilho" title={detalhe} aria-label={`${d.rotulo} — ${detalhe}`}>
              {d.segmentos.map((s, j) => (
                <span key={j} style={{ width: `${(s.valor / maximo) * 100}%`, background: s.cor }} />
              ))}
            </div>
            {/* valor sempre no formato pt-BR (R$ 1.234,56), a partir de centavos uma única vez */}
            <span className="barra-linha__valor" title={detalhe}>{texto(total)}</span>
          </div>
        );
      })}
    </div>
  );
};

/** Evolução mensal dos gastos — SVG medido no container: sem escala reduzida, rótulos em px reais. */
export const GraficoLinha = ({ dados, altura = 168 }:
  { dados: { mes: string; manutencao_centavos: number; calibracao_centavos: number; total_centavos: number }[]; altura?: number }) => {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(360);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(280, Math.round(el.clientWidth)));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  if (!dados.length) return <Vazio titulo="Sem dados no período" />;

  // viewBox = largura renderizada → escala 1, então fontSize é o tamanho real em px
  const W = largura;
  const fs = W < 640 ? 12 : 13;
  const max = Math.max(1, ...dados.map(d => d.total_centavos));
  const textosY = [0, 0.5, 1].map(f => ({ f, valor: Math.round(max * f) }))
    .map(t => ({ ...t, texto: formatarMoeda(t.valor) }));
  const maiorTexto = Math.max(...textosY.map(t => t.texto.length));
  const margemEsq = Math.max(56, Math.round(maiorTexto * fs * 0.6) + 12);
  const margemDir = Math.round(fs * 2);
  const px = (i: number) => margemEsq + (i / Math.max(1, dados.length - 1)) * (W - margemEsq - margemDir);
  const py = (v: number) => altura - 26 - (v / max) * (altura - 48);
  // Rótulos de mês sem sobreposição: passo mínimo de ~44px entre centros (sempre inclui o último).
  const passoPx = (W - margemEsq - margemDir) / Math.max(1, dados.length - 1);
  const passoRotulo = Math.max(1, Math.ceil(44 / Math.max(1, passoPx)));
  const indicesRotulo: number[] = [];
  for (let i = 0; i < dados.length; i += passoRotulo) indicesRotulo.push(i);
  const ultimoIndice = dados.length - 1;
  if (indicesRotulo[indicesRotulo.length - 1] !== ultimoIndice) {
    if (ultimoIndice - indicesRotulo[indicesRotulo.length - 1] < passoRotulo) indicesRotulo.pop();
    indicesRotulo.push(ultimoIndice);
  }
  const linha = (peg: (d: typeof dados[number]) => number) =>
    dados.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(peg(d)).toFixed(1)}`).join(' ');

  return (
    <div ref={caixa} style={{ overflowX: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${altura}`} width="100%" height={altura}
        role="img" aria-label="Evolução dos gastos nos últimos 12 meses">
        {textosY.map(t => (
          <g key={t.f}>
            <line x1={margemEsq} x2={W - 8} y1={py(max * t.f)} y2={py(max * t.f)}
              stroke="#CBD5E1" strokeWidth="1" strokeDasharray="3 3" />
            <text x={margemEsq - 7} y={py(max * t.f) + fs * 0.35} textAnchor="end"
              fontSize={fs} fill="#5B697D">{t.texto}</text>
          </g>
        ))}
        <path d={linha(d => d.manutencao_centavos)} fill="none" stroke="#0B5CAB" strokeWidth="2.2" />
        <path d={linha(d => d.total_centavos)} fill="none" stroke="#0F7360" strokeWidth="2.6" />
        {dados.map((d, i) => (
          <circle key={i} cx={px(i)} cy={py(d.total_centavos)} r="3" fill="#0F7360" />
        ))}
        {indicesRotulo.map(i => (
          <text key={i} x={px(i)} y={altura - 6} textAnchor="middle" fontSize={fs} fill="#5B697D">
            {dados[i].mes.slice(5)}/{dados[i].mes.slice(2, 4)}
          </text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: '.74rem', color: '#5B697D', marginTop: 4, justifyContent: 'center' }}>
        <span><span style={{ color: '#0F7360', fontWeight: 800 }}>—</span> Total</span>
        <span><span style={{ color: '#0B5CAB', fontWeight: 800 }}>—</span> Manutenções</span>
      </div>
    </div>
  );
};

// ---------- Barra de progresso ----------
export const Progresso = ({ feitos, total, rotulo }: { feitos: number; total: number; rotulo?: string }) => {
  const pct = total ? (feitos / total) * 100 : 0;
  return (
    <div className="progresso">
      <div className="progresso__barra" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progresso__preenchido" style={{ width: `${pct}%` }} />
      </div>
      <div className="progresso__texto">{rotulo || 'Progresso'}: {feitos}/{total} respondidos ({formatarPercentual(pct)})</div>
    </div>
  );
};

// ---------- Etiqueta "demonstração" (só aparece quando o hospital é de demonstração) ----------
export const EtiquetaDemo = () => {
  const { usuario } = usarSessao();
  if (!usuario?.dados_demo) return null; // produção: nenhuma tarja de demonstração
  return (
    <div className="aviso aviso--demo">
      <strong>Dados de demonstração</strong>
      Ambiente de demonstração com dados fictícios, sem pacientes nem pessoas reais.
    </div>
  );
};

// ---------- Navegação ----------
const LINKS = [
  { para: '/', icone: 'inicio', rotulo: 'Início' },
  { para: '/equipamentos', icone: 'equipamento', rotulo: 'Equipamentos' },
  { para: '/escanear', icone: 'escanear', rotulo: 'Escanear', destaque: true },
  { para: '/alertas', icone: 'alerta', rotulo: 'Alertas' },
  { para: '/mais', icone: 'mais', rotulo: 'Mais' }
];

export function BarraInferior({ alertas }: { alertas: number }) {
  return (
    <nav className="barra-inferior" aria-label="Navegação principal">
      {LINKS.map(l => (
        <NavLink key={l.para} to={l.para} className={({ isActive }) => isActive ? 'ativo' : ''} end={l.para === '/'}>
          {l.destaque
            ? <span className="selo-escanear"><Icone nome="qr" tam={24} /></span>
            : <span style={{ position: 'relative' }}>
                <Icone nome={l.icone} />
                {l.para === '/alertas' && alertas > 0 && <span className="badge-contador">{alertas > 99 ? '99+' : alertas}</span>}
              </span>}
          <span>{l.rotulo}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const LINKS_PAINEL = [
  ...LINKS.filter(l => l.para !== '/escanear'),
  { para: '/inspecoes', icone: 'check', rotulo: 'Inspeções' },
  { para: '/ocorrencias', icone: 'ocorrencia', rotulo: 'Ocorrências' },
  { para: '/manutencoes', icone: 'manutencao', rotulo: 'Manutenções' },
  { para: '/calibracoes', icone: 'calibracao', rotulo: 'Calibrações' },
  { para: '/relatorios', icone: 'relatorio', rotulo: 'Relatórios' },
  { para: '/config', icone: 'config', rotulo: 'Configurações' }
];

export function PainelLateral({ alertas }: { alertas: number }) {
  const { usuario, pode } = usarSessao();
  const visiveis = LINKS_PAINEL.filter(l => {
    if (l.para === '/config') return pode('config.editar') || pode('auditoria.ver');
    return true;
  });
  return (
    <aside className="painel-lateral">
      <div className="painel-lateral__marca">
        <Marca tam={30} />
        <span className="painel-lateral__nome">HospCheck</span>
      </div>
      <nav className="painel-lateral__nav" aria-label="Navegação do painel">
        {visiveis.map(l => (
          <NavLink key={l.para} to={l.para} className={({ isActive }) => isActive ? 'ativo' : ''} end={l.para === '/'}>
            <Icone nome={l.icone} tam={19} />
            <span>{l.rotulo}</span>
            {l.para === '/alertas' && alertas > 0 &&
              <span className="badge-contador" style={{ position: 'static', transform: 'none', marginLeft: 'auto' }}>{alertas}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="painel-lateral__rodape">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icone nome="usuario" tam={18} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: '#16222E', fontSize: '.8rem' }}>{usuario?.nome}</div>
            <div style={{ fontSize: '.7rem', textTransform: 'capitalize' }}>{perfilRotulo(usuario?.perfil)}</div>
          </div>
        </div>
        <div>Sem integração Google autorizada · banco interno como fonte operacional.</div>
      </div>
    </aside>
  );
}

export const perfilRotulo = (p?: Perfil | string): string => ({
  administrador: 'Administrador', gestor: 'Gestor', inspetor: 'Inspetor',
  manutencao: 'Manutenção', consulta: 'Consulta'
}[p as string] || p || '');

// ---------- Cabeçalho ----------
export function Topo({ titulo, atraso }: { titulo?: string; atraso?: React.ReactNode }) {
  const { usuario, sair } = usarSessao();
  const navegar = useNavigate();
  return (
    <header className="topo">
      <div className="topo__marca">
        <Marca tam={28} />
        <div style={{ minWidth: 0 }}>
          <div className="topo__nome">{titulo || 'HospCheck'}</div>
          <div className="topo__hospital">{usuario?.hospital_nome}</div>
        </div>
      </div>
      <div className="topo__acoes">
        {atraso}
        <button type="button" onClick={() => navegar('/config')}
          className="botao botao--pequeno" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}
          aria-label="Configurações">
          <Icone nome="config" tam={18} />
        </button>
        <button type="button" onClick={() => void sair()}
          className="botao botao--pequeno" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}
          aria-label="Sair">
          <Icone nome="saida" tam={18} />
        </button>
      </div>
    </header>
  );
}

// ---------- Layout ----------
export function Layout({ children, titulo, semBarra = false, atraso }:
  { children: React.ReactNode; titulo?: string; semBarra?: boolean; atraso?: React.ReactNode }) {
  const { usuario } = usarSessao();
  const local = useLocation();
  const [alertas, setAlertas] = useState(0);

  useEffect(() => {
    if (!usuario) return;
    let vivo = true;
    api.get<{ criticos: number; atencao: number }>('/api/alertas')
      .then(r => { if (vivo) setAlertas((r.criticos || 0) + (r.atencao || 0)); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [usuario, local.pathname]);

  return (
    <div className="aplicacao">
      <PainelLateral alertas={alertas} />
      <div className="principal-desktop">
        <Topo titulo={titulo} atraso={atraso} />
        <main className={`conteudo${semBarra ? ' conteudo--sem-barra' : ''}`}>{children}</main>
      </div>
      {!semBarra && <BarraInferior alertas={alertas} />}
    </div>
  );
}

// ---------- Botão voltar ----------
export const Voltar = ({ para, rotulo = 'Voltar' }: { para: string; rotulo?: string }) => {
  const navegar = useNavigate();
  return (
    <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => navegar(para)}
      style={{ marginBottom: 12 }}>
      <Icone nome="voltar" tam={17} /> {rotulo}
    </button>
  );
};
