// HospCheck — tela de inspeção: checklist versionado, foto obrigatória pela câmera
// (capture environment) ou upload, autosave de rascunho e conclusão só após confirmação do servidor.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, enviarArquivo, ErroApi, comprimirImagem, formatarData } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, Icone, Layout, Progresso, Voltar } from '../componentes';

interface ItemModelo { id: string; ordem: number; enunciado: string; exige_justificativa: number; exige_medicao: number; unidade: string | null }
interface Resposta { item_id: string; enunciado?: string; valor?: string | null; justificativa?: string | null; observacao?: string | null; medicao_num?: number | null; medicao_unidade?: string | null }
interface Anexo { id: string; tipo: string; mime: string; criado_em: string; legenda?: string }

type EstadoFoto = 'comprimindo' | 'enviando' | 'ok' | 'erro';

interface FotoPendente { chave: string; estado: EstadoFoto; progresso: number; dataUrl?: string; mensagem?: string }

const ROTULOS_VALOR: Record<string, string> = { conforme: 'Conforme', nao_conforme: 'Não conforme', nao_se_aplica: 'Não se aplica' };

export function TelaInspecao() {
  const params = useParams();
  // Rotas distintas: /inspecoes/:inspecaoId (abrir existente) vs
  // /equipamentos/:equipamentoId/inspecionar (criar rascunho).
  const inspecaoId = params.inspecaoId;
  const equipamentoIdParam = params.equipamentoId;
  const navegar = useNavigate();
  const { pode } = usarSessao();

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: string; texto: string } | null>(null);
  const [inspecao, setInspecao] = useState<any>(null);
  const [equipamento, setEquipamento] = useState<any>(null);
  const [modelo, setModelo] = useState<any>(null);
  const [itens, setItens] = useState<ItemModelo[]>([]);
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({});
  const [fotos, setFotos] = useState<Anexo[]>([]);
  const [observacaoGeral, setObservacaoGeral] = useState('');
  const [fotosPendentes, setFotosPendentes] = useState<FotoPendente[]>([]);
  const [concluindo, setConcluindo] = useState(false);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const inputCamera = useRef<HTMLInputElement>(null);
  const inputUpload = useRef<HTMLInputElement>(null);
  const timerSalva = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- Carrega rascunho (cria se necessário) ----------
  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      let r: any;
      if (inspecaoId && !equipamentoIdParam) {
        r = await api.get<any>(`/api/inspecoes/${inspecaoId}`);
        const i = r.inspecao;
        const mapaItens = r.itens || [];
        setInspecao(i);
        setEquipamento({ id: i.equipamento_id, nome: i.equipamento_nome, codigo: i.codigo });
        setModelo({ id: i.modelo_id, versao: i.modelo_versao, nome: i.modelo_nome });
        setItens(mapaItens.filter((x: any) => x.ativo === 1));
        const inicial: Record<string, Resposta> = {};
        for (const it of mapaItens.filter((x: any) => x.ativo === 1)) {
          const existente = (r.respostas || []).find((x: any) => x.item_id === it.id);
          inicial[it.id] = existente || { item_id: it.id, enunciado: it.enunciado, valor: null, justificativa: null, observacao: null, medicao_num: null };
        }
        setRespostas(inicial);
        setFotos((r.anexos || []).filter((a: any) => a.tipo === 'foto'));
        setObservacaoGeral(i.observacao_geral || '');
        setCarregando(false);
        return;
      }
      if (!equipamentoIdParam) throw new ErroApi('Equipamento não informado.', 400);
      r = await api.post<any>('/api/inspecoes/rascunho', { equipamento_id: equipamentoIdParam });
      setInspecao(r.inspecao);
      setEquipamento(r.equipamento);
      setModelo(r.modelo);
      setItens(r.itens || []);
      const inicial: Record<string, Resposta> = {};
      for (const it of r.itens || []) {
        const existente = (r.respostas || []).find((x: any) => x.item_id === it.id);
        inicial[it.id] = existente || { item_id: it.id, enunciado: it.enunciado, valor: null, justificativa: null, observacao: null, medicao_num: null };
      }
      setRespostas(inicial);
      setFotos((r.fotos || []));
      setObservacaoGeral(r.inspecao.observacao_geral || '');
      navegar(`/inspecoes/${r.inspecao.id}`, { replace: true });
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao abrir a inspeção.');
    } finally { setCarregando(false); }
  }, [inspecaoId, equipamentoIdParam, navegar]);

  useEffect(() => { void carregar(); }, [carregar]);

  const concluida = inspecao?.status === 'concluida' || inspecao?.status === 'retificada';
  const somenteLeitura = concluida || !pode('inspecao.realizar');

  // ---------- Autosave (rascunho) ----------
  const salvarRascunho = useCallback(async (silencioso = true) => {
    if (!inspecao || concluida) return;
    setSalvando(true);
    try {
      const lista = Object.values(respostas).filter(r => r.item_id);
      await api.patch(`/api/inspecoes/${inspecao.id}/rascunho`, { respostas: lista, observacao_geral: observacaoGeral });
      setSalvoEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (!silencioso) setAviso({ tipo: 'sucesso', texto: 'Rascunho salvo no servidor.' });
    } catch (e) {
      if (!silencioso) setErro(e instanceof ErroApi ? e.message : 'Falha ao salvar.');
    } finally { setSalvando(false); }
  }, [inspecao, respostas, observacaoGeral, concluida]);

  // Salva automaticamente 1.2 s após a última alteração
  useEffect(() => {
    if (!inspecao || concluida || somenteLeitura) return;
    if (timerSalva.current) clearTimeout(timerSalva.current);
    timerSalva.current = setTimeout(() => { void salvarRascunho(true); }, 1200);
    return () => { if (timerSalva.current) clearTimeout(timerSalva.current); };
  }, [respostas, observacaoGeral, inspecao, concluida, somenteLeitura, salvarRascunho]);

  // ---------- Respostas ----------
  const responder = (itemId: string, campo: string, valor: any) => {
    if (somenteLeitura) return;
    setRespostas(r => ({ ...r, [itemId]: { ...r[itemId], [campo]: valor } }));
  };

  const respondidos = useMemo(() =>
    itens.filter(i => respostas[i.id]?.valor).length, [itens, respostas]);
  const naoConformes = useMemo(() =>
    itens.filter(i => respostas[i.id]?.valor === 'nao_conforme').length, [itens, respostas]);

  // ---------- Fotos ----------
  const processarArquivo = useCallback(async (arquivo: File) => {
    const chave = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setFotosPendentes(f => [...f, { chave, estado: 'comprimindo', progresso: 0 }]);
    const marcar = (parcial: Partial<FotoPendente>) =>
      setFotosPendentes(f => f.map(x => x.chave === chave ? { ...x, ...parcial } : x));

    try {
      if (!arquivo.type.startsWith('image/')) throw new ErroApi('Selecione um arquivo de imagem.', 0, 'TIPO');
      const { blob, dataUrl } = await comprimirImagem(arquivo);
      marcar({ estado: 'enviando', dataUrl, progresso: 0 });
      const r = await enviarArquivo(`/api/inspecoes/${inspecao.id}/anexos`, blob,
        { tipo: 'foto', nome_original: arquivo.name || 'camera.jpg', legenda: 'Foto registrada na inspeção' },
        (fracao) => marcar({ progresso: Math.round(fracao * 100) }));
      marcar({ estado: 'ok', progresso: 100 });
      const detalhe = await api.get<any>(`/api/inspecoes/${inspecao.id}`);
      setFotos((detalhe.anexos || []).filter((a: any) => a.tipo === 'foto'));
      setAviso({ tipo: 'sucesso', texto: `Foto confirmada pelo servidor (${r.fotos_confirmadas} de ${detalhe.anexos.filter((a: any) => a.tipo === 'foto').length}).` });
    } catch (e) {
      marcar({ estado: 'erro', mensagem: e instanceof ErroApi ? e.message : 'Falha no envio.' });
    } finally {
      setTimeout(() => setFotosPendentes(f => f.filter(x => x.chave !== chave)), 1600);
    }
  }, [inspecao]);

  const aoEscolher = (e: React.ChangeEvent<HTMLInputElement>, origem: string) => {
    const arquivos = Array.from(e.target.files || []);
    arquivos.forEach(a => void processarArquivo(a));
    e.target.value = '';
    setAviso({ tipo: 'info', texto: origem === 'camera' ? 'Enviando foto capturada pela câmera…' : 'Enviando imagem da galeria…' });
  };

  const removerFoto = async (anexoId: string) => {
    try {
      await api.del(`/api/inspecoes/${inspecao.id}/anexos/${anexoId}`);
      setFotos(f => f.filter(a => a.id !== anexoId));
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao remover.'); }
  };

  const tentarNovamente = (arquivo: File) => void processarArquivo(arquivo);

  // ---------- Conclusão ----------
  const concluir = async () => {
    setErro(null); setConcluindo(true);
    try {
      await salvarRascunho(true);
      const r = await api.post<any>(`/api/inspecoes/${inspecao.id}/concluir`);
      const rotuloStatus = r.status === 'concluida' ? 'concluída' : r.status === 'retificada' ? 'retificada' : r.status;
      setAviso({ tipo: 'sucesso', texto: `Inspeção ${rotuloStatus} em ${r.data_conclusao ? new Date(r.data_conclusao).toLocaleString('pt-BR') : 'agora'}.` });
      await carregar();
      if (r.ocorrencias_geradas?.length) {
        setAviso({ tipo: 'atencao', texto: `${r.ocorrencias_geradas.length} ocorrência(s) gerada(s) a partir das não conformidades. Revise em Ocorrências.` });
      }
    } catch (e) {
      if (e instanceof ErroApi) {
        setErro(e.codigo === 'FOTO_OBRIGATORIA'
          ? 'É obrigatório registrar ao menos uma foto atual pela câmera ou upload antes de concluir.'
          : e.message);
        if (e.pendentes?.length) {
          setErro(`${e.message} Itens pendentes: ${e.pendentes.slice(0, 3).join(' | ')}${e.pendentes.length > 3 ? '…' : ''}`);
        }
      } else setErro('Falha ao concluir a inspeção.');
    } finally { setConcluindo(false); }
  };

  if (carregando) return <Layout titulo="Inspeção"><Carregando texto="Abrindo inspeção…" /></Layout>;
  if (erro && !inspecao) return <Layout titulo="Inspeção"><Aviso tipo="erro">{erro}</Aviso></Layout>;

  const podeConcluir = !somenteLeitura && respondidos === itens.length && fotos.length >= 1 &&
    fotosPendentes.every(f => f.estado !== 'enviando' && f.estado !== 'comprimindo');

  return (
    <Layout titulo="Inspeção">
      <Voltar para={`/equipamentos/${equipamento?.id}`} rotulo="Ficha do equipamento" />

      <div className="ficha-cabecalho">
        <div className="ficha-cabecalho__codigo">{equipamento?.codigo}</div>
        <div className="ficha-cabecalho__nome">{equipamento?.nome}</div>
        <div className="ficha-cabecalho__selos">
          <span className="selo selo--azul">Modelo: {modelo?.nome} v{modelo?.versao}</span>
          <span className={`selo selo--${concluida ? 'verde' : 'amarelo'}`}>
            {concluida ? (inspecao.status === 'retificada' ? 'Retificada' : 'Concluída') : 'Rascunho'}
          </span>
          {salvoEm && !concluida && <span className="selo selo--cinza">Salvo {salvoEm}</span>}
        </div>
      </div>

      {concluida && (
        <Aviso tipo="sucesso" titulo="Inspeção encerrada">
          Concluída em {formatarData(inspecao.data_conclusao)}. O histórico é imutável;
          alterações devem ser feitas por retificação auditada (administrador/gestor).
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {!somenteLeitura && (
        <div className="cartao">
          <div className="cartao__titulo"><span>Foto obrigatória</span></div>
          <div className="area-camera">
            <Icone nome="camera" tam={30} />
            <div style={{ fontWeight: 700, marginTop: 6 }}>Registre ao menos 1 foto atual do equipamento</div>
            <div className="area-camera__dica">
              A foto é obrigatória e a conclusão só ocorre após a confirmação do servidor.
              Laudos PDF são opcionais e nunca substituem a foto.
            </div>
            <div className="acoes-linha" style={{ marginTop: 12, justifyContent: 'center' }}>
              <button type="button" className="botao botao--verde" onClick={() => inputCamera.current?.click()}>
                <Icone nome="camera" tam={19} /> Abrir câmera
              </button>
              <button type="button" className="botao botao--contorno" onClick={() => inputUpload.current?.click()}>
                <Icone nome="imagem" tam={19} /> Enviar imagem
              </button>
            </div>
          </div>
          <input ref={inputCamera} className="input-camera" type="file" accept="image/*" capture="environment"
            onChange={e => aoEscolher(e, 'camera')} aria-label="Capturar foto com a câmera" />
          <input ref={inputUpload} className="input-camera" type="file" accept="image/*" multiple
            onChange={e => aoEscolher(e, 'upload')} aria-label="Enviar imagem da galeria" />

          {(fotos.length > 0 || fotosPendentes.length > 0) && (
            <div className="grade-fotos">
              {fotos.map(a => (
                <div className="miniatura" key={a.id}>
                  <img src={`/arquivos/${a.id}`} alt={a.legenda || 'Foto da inspeção'} loading="lazy" />
                  <button type="button" className="miniatura__remover" onClick={() => void removerFoto(a.id)}
                    aria-label="Remover foto" disabled={somenteLeitura}>×</button>
                </div>
              ))}
              {fotosPendentes.map(f => (
                <div className="miniatura" key={f.chave}>
                  {f.dataUrl && f.estado !== 'comprimindo' && <img src={f.dataUrl} alt="Enviando" />}
                  {f.estado === 'comprimindo' && <div className="miniatura__estado">Comprimindo…</div>}
                  {f.estado === 'enviando' && <div className="miniatura__estado">Enviando…{f.progresso}%</div>}
                  {f.estado === 'ok' && <div className="miniatura__estado" style={{ background: 'rgba(228,244,239,.95)', color: '#12856B' }}>✓ Confirmada</div>}
                  {f.estado === 'erro' && (
                    <div className="miniatura__estado miniatura__estado--erro">
                      Falhou
                      <button type="button" className="botao botao--pequeno" style={{ marginTop: 6 }}
                        onClick={() => void tentarNovamente(new File([], 'nova.jpg'))}>Repetir</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="texto-pequeno" style={{ marginTop: 8 }}>
            Fotos confirmadas no servidor: <b>{fotos.length}</b> · a imagem é comprimida no dispositivo (máx. 1600 px, JPEG) antes do envio.
          </p>
        </div>
      )}

      <div className="cartao">
        <div className="cartao__titulo"><span>Checklist — {itens.length} itens</span></div>
        <Progresso feitos={respondidos} total={itens.length} />
        {naoConformes > 0 && (
          <Aviso tipo="atencao">
            {naoConformes} item(ns) marcado(s) como <b>não conforme</b>. Cada um exige descrição
            e gerará uma ocorrência com prioridade, responsável e prazo ao concluir.
          </Aviso>
        )}
      </div>

      {itens.map((item, idx) => {
        const r: Resposta = respostas[item.id] || { item_id: item.id, enunciado: item.enunciado, valor: null, justificativa: null, observacao: null, medicao_num: null };
        return (
          <div className="item-checklist" key={item.id}>
            <div className="item-checklist__enunciado">
              <span className="item-checklist__numero">{idx + 1}</span>
              {item.enunciado}
              {item.exige_medicao === 1 && <span className="selo selo--azul" style={{ marginLeft: 7 }}>medição</span>}
            </div>

            <div className="respostas" role="group" aria-label={`Resposta para ${item.enunciado}`}>
              {['conforme', 'nao_conforme', 'nao_se_aplica'].map(v => (
                <button type="button" key={v}
                  className={`resposta resposta--${v}${r.valor === v ? ' selecionada' : ''}`}
                  onClick={() => responder(item.id, 'valor', v)}
                  disabled={somenteLeitura}
                  aria-pressed={r.valor === v}>
                  {ROTULOS_VALOR[v]}
                </button>
              ))}
            </div>

            {item.exige_medicao === 1 && (
              <div className="campo" style={{ marginTop: 11, marginBottom: 0 }}>
                <label className="campo__rotulo" htmlFor={`med-${item.id}`}>
                  Valor medido {item.unidade ? `(${item.unidade})` : ''}
                </label>
                <input id={`med-${item.id}`} className="entrada" type="number" inputMode="decimal" step="any"
                  placeholder={item.unidade || '0'} value={r.medicao_num ?? ''}
                  onChange={e => responder(item.id, 'medicao_num', e.target.value === '' ? null : Number(e.target.value))}
                  disabled={somenteLeitura} />
              </div>
            )}

            {r.valor === 'nao_conforme' && (
              <>
                <div className="campo" style={{ marginTop: 11, marginBottom: 0 }}>
                  <label className="campo__rotulo" htmlFor={`just-${item.id}`}>
                    Descrição da não conformidade <span className="texto-vermelho">obrigatório</span>
                  </label>
                  <textarea id={`just-${item.id}`} className="area-texto"
                    placeholder="Descreva o problema observado no equipamento…"
                    value={r.justificativa || ''} onChange={e => responder(item.id, 'justificativa', e.target.value)}
                    disabled={somenteLeitura} aria-invalid={r.valor === 'nao_conforme' && !(r.justificativa || '').trim()} />
                  {r.valor === 'nao_conforme' && !(r.justificativa || '').trim() &&
                    <div className="campo__erro">A não conformidade exige descrição antes de concluir.</div>}
                </div>
                <div className="campo" style={{ marginBottom: 0 }}>
                  <label className="campo__rotulo" htmlFor={`prov-${item.id}`}>Providência / ação corretiva</label>
                  <textarea id={`prov-${item.id}`} className="area-texto"
                    placeholder="Qual providência deve ser adotada?"
                    value={r.observacao || ''} onChange={e => responder(item.id, 'observacao', e.target.value)}
                    disabled={somenteLeitura} />
                </div>
              </>
            )}

            {r.valor === 'conforme' && item.exige_justificativa === 1 && (
              <div className="campo" style={{ marginTop: 11, marginBottom: 0 }}>
                <label className="campo__rotulo" htmlFor={`obs-${item.id}`}>Observações</label>
                <textarea id={`obs-${item.id}`} className="area-texto"
                  placeholder="Observação opcional (ex.: leitura registrada)"
                  value={r.observacao || ''} onChange={e => responder(item.id, 'observacao', e.target.value)}
                  disabled={somenteLeitura} />
              </div>
            )}
          </div>
        );
      })}

      <div className="cartao">
        <div className="campo" style={{ marginBottom: 0 }}>
          <label className="campo__rotulo" htmlFor="obs-geral">Observações gerais da inspeção</label>
          <textarea id="obs-geral" className="area-texto" value={observacaoGeral}
            onChange={e => setObservacaoGeral(e.target.value)} disabled={somenteLeitura}
            placeholder="Observações gerais sobre a inspeção…" />
        </div>
      </div>

      {!somenteLeitura && (
        <div className="acoes-linha">
          <button type="button" className="botao botao--contorno" onClick={() => void salvarRascunho(false)} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar rascunho'}
          </button>
          <button type="button" className="botao botao--verde" onClick={() => void concluir()}
            disabled={!podeConcluir || concluindo}>
            {concluindo ? 'Concluindo…' : `Concluir inspeção${fotos.length === 0 ? ' (foto obrigatória)' : ''}`}
          </button>
        </div>
      )}

      {!somenteLeitura && respondidos < itens.length && (
        <p className="texto-pequeno centralizado" style={{ marginTop: 8 }}>
          Responda todos os {itens.length} itens para concluir. O rascunho é salvo automaticamente.
        </p>
      )}
    </Layout>
  );
}
