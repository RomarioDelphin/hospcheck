// HospCheck — geração de PDF real (pdfkit) por equipamento, setor, hospital completo
// e relatórios de vencimentos, ocorrências e gastos. Totais derivados de centavos.
import PDFDocument from 'pdfkit';
import { hojeSP } from './db.js';

const AZUL = '#0B3D6B', VERDE = '#12856B', CINZA = '#5A6B7B', BORDA = '#D6DEE6';

export function brl(centavos) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function dataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function cabecalho(doc, hospital, titulo, filtros) {
  const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const topo = doc.page.margins.top;

  doc.rect(doc.page.margins.left, topo - 6, larg, 4).fill(AZUL);
  doc.y = topo + 10;

  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(16)
    .text(hospital.nome, doc.page.margins.left, doc.y, { width: larg });
  if (hospital.nome_fantasia) {
    doc.fillColor(CINZA).font('Helvetica').fontSize(9)
      .text(hospital.nome_fantasia, doc.page.margins.left, doc.y, { width: larg });
  }
  doc.moveDown(0.3);
  doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(13)
    .text(titulo, doc.page.margins.left, doc.y, { width: larg });
  doc.fillColor(CINZA).font('Helvetica').fontSize(9)
    .text(`Emissão: ${dataBR(hojeSP())} • Período/filtros: ${filtros}`, doc.page.margins.left, doc.y, { width: larg });
  doc.moveDown(0.6);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + larg, doc.y)
    .lineWidth(0.5).strokeColor(BORDA).stroke();
  doc.moveDown(0.6);
  return doc;
}

function indicadores(doc, itens) {
  const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const col = larg / Math.max(itens.length, 1);
  const y0 = doc.y;
  itens.forEach((it, i) => {
    const x = doc.page.margins.left + col * i;
    doc.rect(x, y0, col - 6, 40).fillAndStroke('#F3F7FB', BORDA);
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(16).text(String(it.valor), x + 6, y0 + 7, { width: col - 18, align: 'left' });
    doc.fillColor(CINZA).font('Helvetica').fontSize(7.5).text(it.rotulo, x + 6, y0 + 27, { width: col - 18 });
  });
  doc.y = y0 + 48;
  doc.fillColor('#000');
}

function secao(doc, titulo) {
  const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (doc.y > doc.page.height - 90) doc.addPage();
  doc.rect(doc.page.margins.left, doc.y, larg, 18).fill('#EAF1F8');
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(10).text(titulo, doc.page.margins.left + 6, doc.y + 4.5, { width: larg - 12 });
  doc.fillColor('#000').moveDown(0.5);
}

function par(doc, rotulo, valor) {
  const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  if (doc.y > doc.page.height - 40) doc.addPage();
  const y = doc.y;
  doc.fillColor(CINZA).font('Helvetica').fontSize(9).text(rotulo, doc.page.margins.left + 4, y, { width: larg * 0.35 });
  doc.fillColor('#111').font('Helvetica').fontSize(9).text(valor ?? '—', doc.page.margins.left + 4 + larg * 0.35, y, { width: larg * 0.6 });
  doc.y = y + 14;
}

function tabela(doc, cabecalhos, linhas, larguras) {
  const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = doc.y;
  const alturaLinha = 16;
  const desenharCabecalho = () => {
    doc.rect(doc.page.margins.left, y, larg, 16).fill(AZUL);
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(8);
    let x = doc.page.margins.left;
    cabecalhos.forEach((c, i) => { doc.text(c, x + 4, y + 5, { width: larguras[i] - 8 }); x += larguras[i]; });
    doc.fillColor('#000'); y += 16;
  };
  desenharCabecalho();
  linhas.forEach((linha, idx) => {
    if (y > doc.page.height - doc.page.margins.bottom - alturaLinha) { doc.addPage(); y = doc.y; desenharCabecalho(); }
    doc.rect(doc.page.margins.left, y, larg, alturaLinha).fill(idx % 2 ? '#F7FAFC' : '#FFFFFF');
    doc.font('Helvetica').fontSize(8).fillColor('#222');
    let x = doc.page.margins.left;
    linha.forEach((cel, i) => {
      doc.text(String(cel ?? '—'), x + 4, y + 5, { width: larguras[i] - 8, ellipsis: true, lineBreak: false });
      x += larguras[i];
    });
    doc.fillColor('#000'); y += alturaLinha;
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + larg, y).lineWidth(0.3).strokeColor(BORDA).stroke();
  });
  doc.y = y + 8;
}

function rodape(doc, hospital) {
  const paginas = doc.bufferedPageRange();
  for (let i = paginas.start; i < paginas.start + paginas.count; i++) {
    doc.switchToPage(i);
    const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.fillColor(CINZA).font('Helvetica').fontSize(7.5)
      .text(`${hospital.nome} • HospCheck • Página ${i - paginas.start + 1} de ${paginas.count} • Dados de demonstração`,
        doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 10, { width: larg, align: 'center' });
  }
}

// ---- Anexos: vínculo com o registro de origem e link privado autenticado ----
function vinculoDoAnexo(a, historico = {}) {
  if (a.manutencao_id) {
    const m = (historico.manutencoes || []).find(x => x.id === a.manutencao_id);
    return m ? `Manutenção ${dataBR(m.data)} (${m.tipo})` : 'Manutenção';
  }
  if (a.inspecao_id) {
    const i = (historico.inspecoes || []).find(x => x.id === a.inspecao_id);
    return i ? `Inspeção ${dataBR(i.data_conclusao || i.data_inicio)}` : 'Inspeção';
  }
  if (a.calibracao_id) {
    const c = (historico.calibracoes || []).find(x => x.id === a.calibracao_id);
    return c ? `Calibração ${dataBR(c.data)}` : 'Calibração';
  }
  if (a.ocorrencia_id) {
    const o = (historico.ocorrencias || []).find(x => x.id === a.ocorrencia_id);
    return o ? `Ocorrência ${String(o.titulo || '').slice(0, 26)}` : 'Ocorrência';
  }
  return 'Equipamento';
}

function linkDoAnexo(a, origem) {
  const base = String(origem || '').replace(/\/$/, '');
  return `${base}/arquivos/${a.id}`;
}

// Detalha cada manutenção: peças removidas/instaladas e quantidades (descrição),
// custos em BRL e documentos (NF, recibo, comprovante, laudo) com link.
function detalheManutencoes(doc, manutencoes, anexos, historico, origem) {
  for (const m of manutencoes) {
    if (doc.y > doc.page.height - 150) doc.addPage();
    const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const docs = (anexos || []).filter(a => a.manutencao_id === m.id);
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(9)
      .text(`${dataBR(m.data)} • ${m.tipo} • ${m.empresa || '—'}${m.profissional ? ' / ' + m.profissional : ''}`,
        doc.page.margins.left, doc.y, { width: larg });
    doc.fillColor('#111').font('Helvetica').fontSize(8.5)
      .text(`Peças removidas/instaladas e serviços: ${m.descricao || '—'}`,
        doc.page.margins.left + 6, doc.y, { width: larg - 12 });
    doc.fillColor(CINZA).font('Helvetica').fontSize(8)
      .text(`Peças ${brl(m.pecas_centavos)} • Mão de obra ${brl(m.mao_obra_centavos)} • Outros ${brl(m.outros_centavos)} • Total ${brl(m.total_centavos)}${m.proxima_data ? ` • Próxima ${dataBR(m.proxima_data)}` : ''}`,
        doc.page.margins.left + 6, doc.y, { width: larg - 12 });
    if (docs.length) {
      for (const a of docs) {
        const ref = a.legenda || a.nome_original || a.tipo;
        const url = linkDoAnexo(a, origem);
        doc.fillColor('#111').font('Helvetica').fontSize(8)
          .text(`Documento (${a.tipo}): ${ref} — `, doc.page.margins.left + 6, doc.y, { width: larg - 12, continued: true });
        doc.fillColor('#0B5CAB').text(url, { link: url, underline: true });
      }
    } else {
      doc.fillColor(CINZA).font('Helvetica').fontSize(8)
        .text('Documentos: nenhuma NF/recibo/comprovante anexado a esta manutenção.',
          doc.page.margins.left + 6, doc.y, { width: larg - 12 });
    }
    doc.moveDown(0.5);
  }
  doc.fillColor('#000');
}

// ---- Relatórios ----
export function pdfEquipamento(dados) {
  const { hospital, equipamento, resumo, historico, anexos, filtros, origem } = dados;
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Equipamento ${equipamento.codigo}`, Author: 'HospCheck' } });
  cabecalho(doc, hospital, `Ficha do Equipamento — ${equipamento.nome}`, filtros);
  indicadores(doc, [
    { valor: equipamento.status, rotulo: 'Status' },
    { valor: resumo.inspeccao.rotulo, rotulo: 'Inspeção' },
    { valor: resumo.calibracao.rotulo, rotulo: 'Calibração' },
    { valor: brl(resumo.gasto_total_centavos), rotulo: 'Gasto total' }
  ]);
  secao(doc, 'Identificação');
  par(doc, 'Código', equipamento.codigo);
  par(doc, 'UUID estável', equipamento.id);
  par(doc, 'Instrumento/Tipo', equipamento.tipo);
  par(doc, 'Marca/Modelo', `${equipamento.marca || '—'} / ${equipamento.modelo || '—'}`);
  par(doc, 'Série', equipamento.serie || '—');
  par(doc, 'Patrimônio', equipamento.patrimonio || '—');
  par(doc, 'Setor / Localização', `${equipamento.setor_nome || '—'} — ${equipamento.localizacao || '—'}`);
  par(doc, 'Responsável', equipamento.responsavel_nome || '—');
  par(doc, 'Periodicidade de inspeção', equipamento.periodicidade);
  par(doc, 'Data inicial', dataBR(equipamento.data_inicial));

  secao(doc, 'Situação de vencimentos');
  par(doc, 'Inspeção', `${resumo.inspeccao.rotulo} — vence ${dataBR(resumo.inspeccao.proxima)}${resumo.inspeccao.atraso_dias ? ` (atraso ${resumo.inspeccao.atraso_dias}d)` : ''}`);
  par(doc, 'Calibração', `${resumo.calibracao.rotulo} — vence ${dataBR(resumo.calibracao.proxima)}${resumo.calibracao.atraso_dias ? ` (atraso ${resumo.calibracao.atraso_dias}d)` : ''}`);
  par(doc, 'Manutenção', `${resumo.manutencao.rotulo} — prevista ${dataBR(resumo.manutencao.proxima)}${resumo.manutencao.atraso_dias ? ` (atraso ${resumo.manutencao.atraso_dias}d)` : ''}`);

  if (historico.inspecoes?.length) {
    secao(doc, `Histórico de inspeções (${historico.inspecoes.length})`);
    tabela(doc, ['Data', 'Inspetor', 'Status', 'Resultado', 'Não conf.'],
      historico.inspecoes.map(i => [dataBR(i.data_conclusao || i.data_inicio), i.usuario_nome, i.status, i.resultado || '—', i.nao_conforme_count]),
      [70, 170, 70, 90, 60]);
  }
  if (historico.manutencoes?.length) {
    secao(doc, `Manutenções preventivas/corretivas (${historico.manutencoes.length})`);
    tabela(doc, ['Data', 'Tipo', 'Empresa/Profissional', 'Peças', 'Mão de obra', 'Outros', 'Total', 'Próxima'],
      historico.manutencoes.map(m => [dataBR(m.data), m.tipo, `${m.empresa || '—'} / ${m.profissional || '—'}`,
        brl(m.pecas_centavos), brl(m.mao_obra_centavos), brl(m.outros_centavos), brl(m.total_centavos), dataBR(m.proxima_data)]),
      [52, 52, 150, 58, 62, 48, 62, 58]);
    secao(doc, `Peças, quantidades, custos e documentos por manutenção (${historico.manutencoes.length})`);
    detalheManutencoes(doc, historico.manutencoes, anexos, historico, origem);
  }
  if (historico.calibracoes?.length) {
    secao(doc, `Calibrações (${historico.calibracoes.length})`);
    tabela(doc, ['Data', 'Validade', 'Resultado', 'Empresa/Responsável', 'Custo'],
      historico.calibracoes.map(c => [dataBR(c.data), dataBR(c.validade), c.resultado,
        `${c.empresa || '—'} / ${c.responsavel || '—'}`, brl(c.custo_centavos)]),
      [60, 60, 70, 220, 80]);
  }
  if (historico.ocorrencias?.length) {
    secao(doc, `Ocorrências (${historico.ocorrencias.length})`);
    tabela(doc, ['Data', 'Título', 'Prioridade', 'Status', 'Responsável', 'Prazo'],
      historico.ocorrencias.map(o => [dataBR(o.criado_em), o.titulo, o.prioridade, o.status, o.responsavel_nome || '—', dataBR(o.prazo)]),
      [55, 175, 62, 62, 90, 55]);
  }
  if (anexos?.length) {
    secao(doc, `Anexos e documentos (${anexos.length})`);
    tabela(doc, ['Tipo', 'Arquivo', 'Vínculo', 'KB', 'Data'],
      anexos.map(a => [a.tipo, a.legenda || a.nome_original || '—', vinculoDoAnexo(a, historico),
        Math.round((a.tamanho || 0) / 1024), dataBR(a.criado_em)]),
      [58, 150, 156, 34, 60]);
    secao(doc, 'Links dos documentos (acesso privado, exige sessão)');
    const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    for (const a of anexos) {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const ref = a.legenda || a.nome_original || a.tipo;
      const url = linkDoAnexo(a, origem);
      doc.fillColor('#111').font('Helvetica').fontSize(8)
        .text(`${a.tipo.toUpperCase()} • ${ref} • ${vinculoDoAnexo(a, historico)} — `,
          doc.page.margins.left, doc.y, { width: larg, continued: true });
      doc.fillColor('#0B5CAB').text(url, { link: url, underline: true });
    }
    doc.fillColor('#000');
  }
  rodape(doc, hospital);
  return doc;
}

export function pdfLista({ hospital, titulo, filtros, indic, cabecalhos, larguras, linhas, nota }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: titulo, Author: 'HospCheck' } });
  cabecalho(doc, hospital, titulo, filtros);
  if (indic?.length) indicadores(doc, indic);
  if (linhas.length) tabela(doc, cabecalhos, linhas, larguras);
  else doc.fillColor(CINZA).font('Helvetica').fontSize(10).text('Nenhum registro encontrado para os filtros informados.');
  if (nota) { doc.moveDown(1); doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(nota); }
  rodape(doc, hospital);
  return doc;
}
