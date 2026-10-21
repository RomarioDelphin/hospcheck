// HospCheck — ocorrências: prioridade, responsável, prazo, status e evidência de solução
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, enviarArquivo, ErroApi, comprimirImagem, formatarData, formatarDataHora } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Icone, Layout, Modal, Selo, Vazio } from '../componentes';

export function TelaOcorrencias() {
  const { pode } = usarSessao();
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState(params.get('status') || '');
  const [aberta, setAberta] = useState<any | null>(null);
  const [evidencia, setEvidencia] = useState<{ id: string; url: string } | null>(null);
  const [salvandoEvidencia, setSalvandoEvidencia] = useState(false);
  const [progresso, setProgresso] = useState(0);

  const podeGerir = pode('ocorrencia.gerir');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      setLista(await api.get('/api/ocorrencias' + (p.toString() ? `?${p}` : '')));
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.'); }
    finally { setCarregando(false); }
  }, [status]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const p = new URLSearchParams(); if (status) p.set('status', status); setParams(p, { replace: true }); }, [status, setParams]);

  useEffect(() => {
    Promise.all([
      api.get<any[]>('/api/equipamentos').catch(() => []),
      podeGerir ? api.get<any[]>('/api/usuarios').catch(() => []) : Promise.resolve([])
    ]).then(([eq, us]) => { setEquipamentos(eq); setUsuarios(us); });
  }, [podeGerir]);

  const enviarEvidencia = async (arquivo: File) => {
    if (!aberta) return;
    setSalvandoEvidencia(true); setProgresso(0);
    try {
      const { blob, dataUrl } = await comprimirImagem(arquivo);
      const r = await enviarArquivo(`/api/ocorrencias/${aberta.id}/anexos`, blob,
        { tipo: 'comprovante', nome_original: arquivo.name, legenda: 'Evidência da solução' },
        f => setProgresso(Math.round(f * 100)));
      setEvidencia({ id: r.anexo.id, url: dataUrl });
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha no envio da evidência.'); }
    finally { setSalvandoEvidencia(false); }
  };

  const resolver = async (form: React.FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const fd = new FormData(form.currentTarget);
    const descricao = String(fd.get('resolucao') || '').trim();
    setErro(null);
    if (!descricao) { setErro('Descreva a solução aplicada.'); return; }
    if (!evidencia) { setErro('Anexe a evidência (foto/comprovante) para resolver a ocorrência.'); return; }
    try {
      await api.patch(`/api/ocorrencias/${aberta.id}`, {
        status: 'resolvida', resolucao_descricao: descricao, evidencia_anexo_id: evidencia.id });
      setAberta(null); setEvidencia(null); await carregar();
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao resolver.'); }
  };

  const atualizarStatus = async (id: string, novoStatus: string) => {
    try { await api.patch(`/api/ocorrencias/${id}`, { status: novoStatus }); await carregar(); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao atualizar.'); }
  };

  const contagem = (s: string) => lista.filter(o => o.status === s).length;
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <Layout titulo="Ocorrências">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="grade-cartoes">
        <div className="metrica metrica--vermelho"><span className="metrica__valor">{contagem('aberta')}</span><span className="metrica__rotulo">Abertas</span></div>
        <div className="metrica metrica--laranja"><span className="metrica__valor">{contagem('em_andamento')}</span><span className="metrica__rotulo">Em andamento</span></div>
        <div className="metrica metrica--verde"><span className="metrica__valor">{contagem('resolvida')}</span><span className="metrica__rotulo">Resolvidas</span></div>
        <div className="metrica metrica--vermelho"><span className="metrica__valor">{lista.filter(o => o.prioridade === 'critica').length}</span><span className="metrica__rotulo">Críticas</span></div>
      </div>

      <div className="filtros">
        {[['', 'Todas'], ['aberta', 'Abertas'], ['em_andamento', 'Em andamento'], ['resolvida', 'Resolvidas']].map(([v, r]) => (
          <button key={v} className={`filtro-pilula${status === v ? ' ativo' : ''}`} onClick={() => setStatus(v!)}>{r}</button>
        ))}
      </div>

      {carregando && <Carregando />}
      {!carregando && lista.length === 0 && <Vazio titulo="Nenhuma ocorrência" />}

      <ul className="lista">
        {lista.map(o => {
          const atrasada = o.prazo && o.prazo < hoje && o.status !== 'resolvida' && o.status !== 'cancelada';
          return (
            <li key={o.id}>
              <div className="item-lista">
                <div className="item-lista__topo">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-lista__titulo">{o.titulo}</div>
                    <div className="item-lista__sub">{o.codigo} · {o.equipamento_nome}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Selo valor={o.prioridade} /><Selo valor={o.status} />
                  </div>
                </div>
                <p style={{ fontSize: '.84rem', margin: '8px 0 6px' }}>{o.descricao}</p>
                {o.providencia && (
                  <p style={{ fontSize: '.8rem', margin: '0 0 6px', color: '#3C4C5C' }}>
                    <b>Providência:</b> {o.providencia}
                  </p>
                )}
                <div className="item-lista__meta">
                  <span className="selo">Resp.: {o.responsavel_nome || 'não definido'}</span>
                  {o.prazo && <span className={`selo selo--${atrasada ? 'vermelho' : 'cinza'}`}>
                    Prazo {formatarData(o.prazo)}{atrasada ? ' (atrasada)' : ''}</span>}
                  {!!o.anexos && <span className="selo selo--azul">{o.anexos} anexo(s)</span>}
                  <span className="selo">Aberta {formatarDataHora(o.criado_em)}</span>
                </div>
                {o.status === 'resolvida' && (
                  <div className="aviso aviso--sucesso" style={{ marginTop: 9, marginBottom: 0 }}>
                    <strong>Resolvida em {formatarDataHora(o.resolvida_em)}</strong>
                    {o.resolucao_descricao}
                  </div>
                )}
                {podeGerir && (o.status === 'aberta' || o.status === 'em_andamento') && (
                  <div className="acoes-linha" style={{ marginTop: 10 }}>
                    {o.status === 'aberta' && (
                      <button className="botao botao--contorno botao--pequeno" onClick={() => void atualizarStatus(o.id, 'em_andamento')}>
                        Iniciar atendimento
                      </button>
                    )}
                    <button className="botao botao--verde botao--pequeno" onClick={() => { setAberta(o); setEvidencia(null); }}>
                      <Icone nome="check" tam={16} /> Registrar solução
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal aberto={!!aberta} aoFechar={() => { setAberta(null); setEvidencia(null); }} titulo="Registrar solução">
        {aberta && (
          <form onSubmit={resolver}>
            <div className="aviso aviso--info">
              <strong>{aberta.titulo}</strong>
              {aberta.equipamento_nome}
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="resolucao">
                Descrição da solução aplicada <span className="texto-vermelho">obrigatório</span>
              </label>
              <textarea id="resolucao" name="resolucao" className="area-texto" required
                placeholder="Descreva o que foi feito para eliminar a ocorrência…" />
            </div>
            <div className="campo">
              <label className="campo__rotulo">
                Evidência (foto ou comprovante) <span className="texto-vermelho">obrigatório</span>
              </label>
              <input type="file" accept="image/*" capture="environment" className="entrada"
                onChange={e => { const f = e.target.files?.[0]; if (f) void enviarEvidencia(f); }} />
              {salvandoEvidencia && <div className="campo__ajuda">Enviando… {progresso}%</div>}
              {evidencia && (
                <div className="grade-fotos" style={{ marginTop: 9 }}>
                  <div className="miniatura"><img src={evidencia.url} alt="Evidência anexada" /></div>
                </div>
              )}
              <div className="campo__ajuda">A resolução só é registrada com a evidência confirmada no servidor.</div>
            </div>
            <div className="acoes-linha">
              <button type="button" className="botao botao--fantasma" onClick={() => { setAberta(null); setEvidencia(null); }}>Cancelar</button>
              <button type="submit" className="botao botao--verde" disabled={!evidencia || salvandoEvidencia}>
                Confirmar resolução
              </button>
            </div>
          </form>
        )}
      </Modal>
    </Layout>
  );
}
