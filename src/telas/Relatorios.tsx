// HospCheck — relatórios: PDFs reais por equipamento/setor/hospital e relatórios de
// vencimentos, ocorrências e gastos, além de exportação CSV/Excel.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, EtiquetaDemo, Icone, Layout } from '../componentes';

const TIPOS = [
  { v: 'equipamento', rotulo: 'Ficha de um equipamento', precisaEquipamento: true,
    desc: 'Dados, histórico completo de inspeções/manutenções/calibrações, custos, responsáveis, anexos e totais.' },
  { v: 'setor', rotulo: 'Relatório de setor', precisaSetor: true,
    desc: 'Todos os equipamentos de um setor com situação de vencimentos e gastos.' },
  { v: 'hospital', rotulo: 'Hospital completo', precisaSetor: false,
    desc: 'Panorama geral de todos os equipamentos ativos com indicadores e totais.' },
  { v: 'vencimentos', rotulo: 'Vencimentos', precisaSetor: false,
    desc: 'Inspeções, calibrações e manutenções em dia, próximas ou vencidas.' },
  { v: 'ocorrencias', rotulo: 'Ocorrências', precisaSetor: false,
    desc: 'Ocorrências com prioridade, status, responsável e prazo.' },
  { v: 'gastos', rotulo: 'Gastos', precisaSetor: false, desc: 'Manutenções e calibrações no período, com totais derivados.' }
];

const EXPORTACOES = [
  ['equipamentos', 'Equipamentos'], ['inspecoes', 'Inspeções'], ['manutencoes', 'Manutenções'],
  ['calibracoes', 'Calibrações'], ['ocorrencias', 'Ocorrências'], ['gastos', 'Gastos']
];

export function TelaRelatorios() {
  const { usuario, pode } = usarSessao();
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [tipo, setTipo] = useState('hospital');
  const [equipamentoId, setEquipamentoId] = useState('');
  const [setorId, setSetorId] = useState('');
  const [desde, setDesde] = useState(new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
  const [ate, setAte] = useState(new Date().toISOString().slice(0, 10));
  const [gerando, setGerando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.get<any[]>('/api/equipamentos').then(setEquipamentos).catch(() => {});
    api.get<any[]>('/api/setores').then(setSetores).catch(() => {});
  }, []);

  const escolhido = useMemo(() => TIPOS.find(t => t.v === tipo)!, [tipo]);
  const podeGerar = pode('relatorio.gerar');

  const montarUrl = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ tipo, desde, ate, ...extra });
    if (setorId) p.set('setor_id', setorId);
    if (tipo === 'equipamento' && equipamentoId) p.set('equipamento_id', equipamentoId);
    return `/api/relatorios/pdf?${p}`;
  };

  const abrirPdf = (extra: Record<string, string> = {}) => {
    setErro(null);
    if (tipo === 'equipamento' && !equipamentoId) { setErro('Selecione o equipamento para gerar a ficha.'); return; }
    if (tipo === 'setor' && !setorId) { setErro('Selecione o setor para gerar o relatório.'); return; }
    setGerando('pdf');
    // Abre em nova aba; o navegador faz o download/visualização do PDF real.
    window.open(montarUrl(extra), '_blank', 'noopener');
    setTimeout(() => setGerando(null), 900);
  };

  const exportarCsv = (relatorio: string) => {
    setErro(null);
    setGerando(relatorio);
    const p = new URLSearchParams({ relatorio, desde, ate });
    if (setorId) p.set('setor_id', setorId);
    window.open(`/api/relatorios/csv?${p}`, '_blank', 'noopener');
    setTimeout(() => setGerando(null), 900);
  };

  return (
    <Layout titulo="Relatórios">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {!podeGerar && (
        <Aviso tipo="atencao">Seu perfil pode exportar dados, mas não gerar relatórios completos.</Aviso>
      )}

      <div className="cartao">
        <div className="cartao__titulo">Escopo e filtros</div>
        <div className="campo">
          <label className="campo__rotulo" htmlFor="r-tipo">Tipo de relatório</label>
          <select id="r-tipo" className="seletor" value={tipo} onChange={e => { setTipo(e.target.value); setErro(null); }}>
            {TIPOS.map(t => <option key={t.v} value={t.v}>{t.rotulo}</option>)}
          </select>
          <div className="campo__ajuda">{escolhido.desc}</div>
        </div>

        {escolhido.precisaEquipamento && (
          <div className="campo">
            <label className="campo__rotulo" htmlFor="r-eq">Equipamento <span className="texto-vermelho">*</span></label>
            <select id="r-eq" className="seletor" value={equipamentoId} onChange={e => setEquipamentoId(e.target.value)}>
              <option value="">Selecione…</option>
              {equipamentos.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nome}</option>)}
            </select>
          </div>
        )}
        {escolhido.precisaSetor && (
          <div className="campo">
            <label className="campo__rotulo" htmlFor="r-setor">Setor <span className="texto-vermelho">*</span></label>
            <select id="r-setor" className="seletor" value={setorId} onChange={e => setSetorId(e.target.value)}>
              <option value="">Selecione…</option>
              {setores.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
        )}

        <div className="grade-campos">
          <div className="campo">
            <label className="campo__rotulo" htmlFor="r-desde">Período — de</label>
            <input id="r-desde" className="entrada" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="r-ate">Período — até</label>
            <input id="r-ate" className="entrada" type="date" value={ate} onChange={e => setAte(e.target.value)} />
          </div>
        </div>
        {(setorId || desde || ate) && (
          <p className="texto-pequeno">
            Filtros aplicados no cabeçalho do PDF: {[
              setorId && `setor ${setores.find(s => s.id === setorId)?.nome || ''}`,
              tipo === 'equipamento' && equipamentoId && `equipamento ${equipamentos.find(e => e.id === equipamentoId)?.codigo}`,
              `período ${desde} a ${ate}`
            ].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className="acoes-linha" style={{ marginTop: 12 }}>
          <button className="botao botao--verde" onClick={() => abrirPdf()} disabled={!!gerando || !podeGerar}>
            <Icone nome="download" tam={19} /> {gerando === 'pdf' ? 'Gerando…' : 'Gerar PDF'}
          </button>
          {tipo === 'hospital' && (
            <>
              <button className="botao botao--contorno" onClick={() => abrirPdf({})}>PDF sem setor</button>
              <button className="botao botao--contorno" onClick={() => abrirPdf({})}>PDF com fotos</button>
            </>
          )}
        </div>
      </div>

      <div className="cartao">
        <div className="cartao__titulo"><span>Exportação CSV / Excel</span></div>
        <p className="texto-pequeno">
          Arquivos CSV com separador <b>;</b> e BOM UTF-8 — abrem direto no Excel (pt-BR) preservando acentos.
        </p>
        <div className="acoes-linha">
          {EXPORTACOES.map(([v, r]) => (
            <button key={v} className="botao botao--contorno botao--pequeno"
              onClick={() => exportarCsv(v)} disabled={gerando === v}>
              {gerando === v ? 'Exportando…' : r}
            </button>
          ))}
        </div>
      </div>

      <div className="cartao">
        <div className="cartao__titulo">Conteúdo dos relatórios</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '.85rem', lineHeight: 1.7 }}>
          <li>Logo e nome do hospital, emissão, período e filtros aplicados.</li>
          <li>Indicadores no topo (ativos, vencidas, gastos, pontualidade).</li>
          <li>Detalhes e histórico por equipamento, com responsáveis.</li>
          <li>Lista de anexos e totais derivados de valores em centavos.</li>
          <li>Paginação automática e rodapé com número de página.</li>
        </ul>
        <p className="texto-pequeno" style={{ marginTop: 8 }}>
          Emitido por: {usuario?.nome} ({usuario?.perfil}) · fuso America/Sao_Paulo
        </p>
      </div>
    </Layout>
  );
}
