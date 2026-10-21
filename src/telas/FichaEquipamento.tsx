// HospCheck — ficha do equipamento (destino do QR Code): dados, histórico, fotos,
// laudos, custos, calibração/manutenção e botão "Realizar inspeção".
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ErroApi, formatarData, formatarDataHora, formatarMoeda } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, Icone, Layout, Modal, Selo, Voltar, Vazio } from '../componentes';

export function TelaFicha() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { usuario, pode } = usarSessao();
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<'resumo' | 'inspecoes' | 'manutencoes' | 'calibracoes' | 'ocorrencias' | 'anexos'>('resumo');
  const [abrirStatus, setAbrirStatus] = useState(false);
  const [novoStatus, setNovoStatus] = useState('operacional');
  const [motivo, setMotivo] = useState('');
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [erroStatus, setErroStatus] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try { setDados(await api.get(`/api/equipamentos/${id}`)); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Equipamento não encontrado.'); }
    finally { setCarregando(false); }
  }, [id]);

  useEffect(() => { void carregar(); }, [carregar]);

  const alterarStatus = async () => {
    setSalvandoStatus(true); setErroStatus(null);
    try {
      await api.post(`/api/equipamentos/${id}/status`, { status: novoStatus, motivo });
      setAbrirStatus(false); setMotivo('');
      await carregar();
    } catch (e) { setErroStatus(e instanceof ErroApi ? e.message : 'Falha ao alterar.'); }
    finally { setSalvandoStatus(false); }
  };

  const baixarPdf = (tipo: string) => {
    const url = `/api/relatorios/pdf?tipo=${tipo}${tipo === 'equipamento' ? `&equipamento_id=${id}` : ''}`;
    window.open(url, '_blank', 'noopener');
  };

  if (carregando) return <Layout titulo="Ficha"><Carregando /></Layout>;
  if (erro || !dados) return (
    <Layout titulo="Ficha">
      <Voltar para="/equipamentos" />
      <Aviso tipo="erro">{erro || 'Equipamento não encontrado.'}</Aviso>
    </Layout>
  );

  const { equipamento: e, resumo, historico, anexos, total_gasto_centavos, url_estavel } = dados;
  // Fotos reais do equipamento (anexos de imagem), exibidas na ficha aberta pelo QR
  const fotos = (anexos || []).filter((a: any) => String(a.mime || '').startsWith('image/'));
  const r = resumo;
  const podeInterditar = pode('equipamento.status');

  return (
    <Layout titulo="Ficha do equipamento">
      <Voltar para="/equipamentos" />

      <div className="ficha-cabecalho">
        <div className="ficha-cabecalho__codigo">{e.codigo} · {e.tipo}</div>
        <div className="ficha-cabecalho__nome">{e.nome}</div>
        <div className="ficha-cabecalho__selos">
          <span className={`selo selo--${e.status === 'operacional' ? 'verde' : e.status === 'interditado' ? 'vermelho' : e.status === 'restricao' ? 'laranja' : 'amarelo'}`}>
            {e.status === 'operacional' ? 'Operacional' : e.status === 'interditado' ? 'Interditado' : e.status === 'restricao' ? 'Com restrição' : e.status === 'manutencao' ? 'Em manutenção' : 'Desativado'}
          </span>
          <span className={`selo selo--${r.inspeccao.situacao === 'vencida' ? 'vermelho' : r.inspeccao.situacao === 'proxima' ? 'laranja' : 'verde'}`}>
            {r.inspeccao.rotulo}
          </span>
        </div>
      </div>

      {e.status === 'interditado' && (
        <Aviso tipo="erro" titulo="Equipamento interditado">
          Uso proibido até liberação formal por responsável autorizado (administrador/gestor).
        </Aviso>
      )}

      <div className="acoes-linha" style={{ marginBottom: 14 }}>
        {pode('inspecao.realizar') && (
          <button className="botao botao--verde botao--grande" onClick={() => navegar(`/equipamentos/${e.id}/inspecionar`)}>
            <Icone nome="camera" tam={20} /> Realizar inspeção
          </button>
        )}
        {pode('equipamento.editar') && (
          <Link to={`/equipamentos/${e.id}/editar`} className="botao botao--contorno">
            <Icone nome="config" tam={18} /> Editar
          </Link>
        )}
        {podeInterditar && (
          <button className="botao botao--contorno" onClick={() => { setNovoStatus(e.status === 'interditado' ? 'operacional' : 'interditado'); setAbrirStatus(true); }}>
            <Icone nome="alerta" tam={18} /> {e.status === 'interditado' ? 'Liberar' : 'Interditar'}
          </button>
        )}
      </div>

      <div className="abas" role="tablist">
        {([['resumo', 'Resumo'], ['inspecoes', `Inspeções (${historico.inspecoes.length})`],
          ['manutencoes', `Manutenções (${historico.manutencoes.length})`],
          ['calibracoes', `Calibrações (${historico.calibracoes.length})`],
          ['ocorrencias', `Ocorrências (${historico.ocorrencias.length})`],
          ['anexos', `Anexos (${anexos.length})`]] as const).map(([v, r2]) => (
          <button key={v} className={`aba${aba === v ? ' ativa' : ''}`} onClick={() => setAba(v)} role="tab"
            aria-selected={aba === v}>{r2}</button>
        ))}
      </div>

      {aba === 'resumo' && (
        <>
          {fotos.length > 0 && (
            <div className="cartao">
              <div className="cartao__titulo">
                <span>Fotos do equipamento</span>
                <span className="texto-pequeno">{fotos.length} foto(s)</span>
              </div>
              <div className="grade-fotos">
                {fotos.map((a: any) => (
                  <a className="miniatura" key={a.id} href={`/arquivos/${a.id}`} target="_blank"
                    rel="noopener noreferrer" title={a.legenda || a.nome_original || 'Foto do equipamento'}>
                    <img src={`/arquivos/${a.id}`} alt={a.legenda || a.nome_original || 'Foto do equipamento'} loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="cartao">
            <div className="cartao__titulo">Situação de vencimentos</div>
            <dl className="dl">
              <div className="linha-chave-valor"><dt>Inspeção</dt>
                <dd><Selo valor={r.inspeccao.situacao} /> <span className="texto-pequeno">vence {formatarData(r.inspeccao.proxima)}{r.inspeccao.atraso_dias ? ` (atraso ${r.inspeccao.atraso_dias}d)` : ''}</span></dd></div>
              <div className="linha-chave-valor"><dt>Calibração</dt>
                <dd><Selo valor={r.calibracao.situacao} /> <span className="texto-pequeno">vence {formatarData(r.calibracao.proxima)}</span></dd></div>
              <div className="linha-chave-valor"><dt>Manutenção</dt>
                <dd><Selo valor={r.manutencao.situacao} /> <span className="texto-pequeno">prevista {formatarData(r.manutencao.proxima)}</span></dd></div>
            </dl>
            <p className="texto-pequeno" style={{ marginTop: 8 }}>
              Os três prazos são independentes: concluir a checklist <b>não</b> renova calibração nem manutenção.
            </p>
          </div>

          <div className="cartao">
            <div className="cartao__titulo">Identificação</div>
            <dl className="dl">
              <div className="linha-chave-valor"><dt>UUID estável</dt><dd style={{ fontSize: '.72rem', wordBreak: 'break-all' }}>{e.id}</dd></div>
              <div className="linha-chave-valor"><dt>Instrumento/Tipo</dt><dd>{e.tipo}</dd></div>
              <div className="linha-chave-valor"><dt>Marca/Modelo</dt><dd>{e.marca || '—'} / {e.modelo || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Série</dt><dd>{e.serie || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Patrimônio</dt><dd>{e.patrimonio || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Setor</dt><dd>{e.setor_nome || '—'}{e.setor_andar ? ` (${e.setor_andar})` : ''}</dd></div>
              <div className="linha-chave-valor"><dt>Localização</dt><dd>{e.localizacao || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Responsável</dt><dd>{e.responsavel_nome || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Periodicidade</dt><dd style={{ textTransform: 'capitalize' }}>{e.periodicidade}</dd></div>
              <div className="linha-chave-valor"><dt>Data inicial</dt><dd>{formatarData(e.data_inicial)}</dd></div>
            </dl>
          </div>

          <div className="cartao">
            <div className="cartao__titulo">Custos acumulados</div>
            <dl className="dl">
              <div className="linha-chave-valor"><dt>Manutenções</dt><dd>{formatarMoeda(r.gasto_manutencao_centavos)}</dd></div>
              <div className="linha-chave-valor"><dt>Calibrações</dt><dd>{formatarMoeda(r.gasto_calibracao_centavos)}</dd></div>
              <div className="linha-chave-valor"><dt className="negrito">Total</dt><dd className="texto-verde">{formatarMoeda(total_gasto_centavos)}</dd></div>
            </dl>
          </div>

          <div className="cartao">
            <div className="cartao__titulo">QR Code — etiqueta imprimível</div>
            <p className="texto-pequeno">
              O QR contém apenas a URL estável do equipamento; ele não expõe dados privados.
              Sem autenticação, a leitura leva ao login preservando o destino.
            </p>
            <div className="acoes-linha">
              <button className="botao botao--contorno" onClick={() => window.open(`/api/equipamentos/${e.id}/qr.png?tamanho=600`, '_blank', 'noopener')}>
                <Icone nome="qr" tam={18} /> Ver QR em alta
              </button>
              <button className="botao botao--contorno" onClick={() => window.open(`/api/equipamentos/${e.id}/etiqueta.pdf`, '_blank', 'noopener')}>
                <Icone nome="download" tam={18} /> Baixar etiqueta (PDF)
              </button>
            </div>
            <div className="qr-caixa" style={{ marginTop: 12 }}>
              <img src={`/api/equipamentos/${e.id}/qr.png?tamanho=350`} alt={`QR Code de ${e.nome}`} />
              <div className="texto-pequeno" style={{ marginTop: 6, wordBreak: 'break-all' }}>{url_estavel}</div>
            </div>
          </div>

          <div className="acoes-linha">
            <button className="botao botao--contorno" onClick={() => baixarPdf('equipamento')}>
              <Icone nome="relatorio" tam={18} /> Baixar PDF desta ficha
            </button>
          </div>
        </>
      )}

      {aba === 'inspecoes' && (
        historico.inspecoes.length === 0 ? <Vazio titulo="Nenhuma inspeção registrada" /> :
        <ul className="lista">
          {historico.inspecoes.map((i: any) => (
            <li key={i.id}>
              <Link className="item-lista" to={`/inspecoes/${i.id}`}>
                <div className="item-lista__topo">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-lista__titulo">{formatarData(i.data_conclusao || i.data_inicio)}</div>
                    <div className="item-lista__sub">{i.usuario_nome} · modelo v{i.modelo_versao}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Selo valor={i.status} />
                    {i.resultado && <Selo valor={i.resultado} />}
                  </div>
                </div>
                {!!i.nao_conforme_count && <div className="item-lista__meta"><span className="selo selo--vermelho">{i.nao_conforme_count} não conformidade(s)</span></div>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {aba === 'manutencoes' && (
        historico.manutencoes.length === 0 ? <Vazio titulo="Nenhuma manutenção registrada" /> :
        historico.manutencoes.map((m: any) => (
          <div className="cartao" key={m.id}>
            <div className="cartao__titulo">
              <span>{formatarData(m.data)} — {m.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}</span>
              <span className="texto-verde">{formatarMoeda(m.total_centavos)}</span>
            </div>
            <p style={{ marginBottom: 6 }}>{m.descricao}</p>
            <dl className="dl">
              <div className="linha-chave-valor"><dt>Empresa/Profissional</dt><dd>{m.empresa || '—'} / {m.profissional || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Peças</dt><dd>{formatarMoeda(m.pecas_centavos)}</dd></div>
              <div className="linha-chave-valor"><dt>Mão de obra</dt><dd>{formatarMoeda(m.mao_obra_centavos)}</dd></div>
              <div className="linha-chave-valor"><dt>Outros</dt><dd>{formatarMoeda(m.outros_centavos)}</dd></div>
              <div className="linha-chave-valor"><dt>Próxima data</dt><dd>{formatarData(m.proxima_data)}</dd></div>
            </dl>
          </div>
        ))
      )}

      {aba === 'calibracoes' && (
        historico.calibracoes.length === 0 ? <Vazio titulo="Nenhuma calibração registrada" /> :
        historico.calibracoes.map((c: any) => (
          <div className="cartao" key={c.id}>
            <div className="cartao__titulo">
              <span>{formatarData(c.data)} — válida até {formatarData(c.validade)}</span>
              <Selo valor={c.resultado} />
            </div>
            <dl className="dl">
              <div className="linha-chave-valor"><dt>Empresa</dt><dd>{c.empresa || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Responsável</dt><dd>{c.responsavel || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Custo</dt><dd>{formatarMoeda(c.custo_centavos)}</dd></div>
              {c.observacao && <div className="linha-chave-valor"><dt>Observação</dt><dd>{c.observacao}</dd></div>}
              {c.certificado_anexo_id && (
                <div className="linha-chave-valor"><dt>Certificado</dt>
                  <dd><a href={`/arquivos/${c.certificado_anexo_id}`} target="_blank" rel="noopener noreferrer">Abrir certificado PDF</a></dd></div>
              )}
            </dl>
          </div>
        ))
      )}

      {aba === 'ocorrencias' && (
        historico.ocorrencias.length === 0 ? <Vazio titulo="Nenhuma ocorrência" /> :
        <ul className="lista">
          {historico.ocorrencias.map((o: any) => (
            <li key={o.id}>
              <Link className="item-lista" to={`/ocorrencias?id=${o.id}`}>
                <div className="item-lista__topo">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-lista__titulo">{o.titulo}</div>
                    <div className="item-lista__sub">{formatarDataHora(o.criado_em)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <Selo valor={o.prioridade} /><Selo valor={o.status} />
                  </div>
                </div>
                <div className="item-lista__meta">
                  {o.responsavel_nome && <span className="selo">Resp.: {o.responsavel_nome}</span>}
                  {o.prazo && <span className={`selo selo--${o.prazo < new Date().toISOString().slice(0, 10) && o.status !== 'resolvida' ? 'vermelho' : 'cinza'}`}>Prazo {formatarData(o.prazo)}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {aba === 'anexos' && (
        anexos.length === 0 ? <Vazio titulo="Nenhum anexo" /> :
        <ul className="lista">
          {anexos.map((a: any) => (
            <li key={a.id}>
              <a className="item-lista" href={`/arquivos/${a.id}`} target="_blank" rel="noopener noreferrer">
                <div className="item-lista__topo">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-lista__titulo">{a.legenda || a.nome_original || a.tipo}</div>
                    <div className="item-lista__sub">{a.tipo} · {Math.round((a.tamanho || 0) / 1024)} KB · {formatarDataHora(a.criado_em)}</div>
                  </div>
                  <span className="selo selo--azul">{a.mime === 'application/pdf' ? 'PDF' : 'Imagem'}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}

      <Modal aberto={abrirStatus} aoFechar={() => setAbrirStatus(false)}
        titulo={novoStatus === 'interditado' ? 'Interditar equipamento' : 'Liberar equipamento'}>
        {erroStatus && <Aviso tipo="erro">{erroStatus}</Aviso>}
        <Aviso tipo="atencao">
          Ação restrita a <b>administrador</b> ou <b>gestor</b>. A alteração fica registrada na auditoria
          com usuário, data, hora e motivo.
        </Aviso>
        <div className="campo">
          <label className="campo__rotulo" htmlFor="motivo-status">
            Motivo / justificativa <span className="texto-vermelho">obrigatório</span>
          </label>
          <textarea id="motivo-status" className="area-texto" value={motivo} onChange={ev => setMotivo(ev.target.value)}
            placeholder={novoStatus === 'interditado' ? 'Descreva a falha ou condição que exige a interdição…' : 'Descreva a verificação que permite a liberação…'}
            aria-invalid={!motivo.trim()} />
          {!motivo.trim() && <div className="campo__erro">Informe o motivo para continuar.</div>}
        </div>
        <div className="acoes-linha">
          <button className="botao botao--fantasma" onClick={() => setAbrirStatus(false)}>Cancelar</button>
          <button className={`botao ${novoStatus === 'interditado' ? 'botao--perigo' : 'botao--verde'}`}
            onClick={() => void alterarStatus()} disabled={!motivo.trim() || salvandoStatus}>
            {salvandoStatus ? 'Registrando…' : (novoStatus === 'interditado' ? 'Confirmar interdição' : 'Confirmar liberação')}
          </button>
        </div>
      </Modal>
    </Layout>
  );
}
