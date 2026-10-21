// HospCheck — calibrações: data, validade, resultado, empresa, custo e certificado
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, enviarArquivo, ErroApi, ehDataValida, formatarData, formatarMoeda, comprimirImagem } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Icone, Layout, Modal, Selo, Vazio } from '../componentes';

export function TelaCalibracoes() {
  const { pode } = usarSessao();
  const [lista, setLista] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [certificado, setCertificado] = useState<{ id: string } | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [ultimaCriada, setUltimaCriada] = useState<string | null>(null);

  const podeRegistrar = pode('calibracao.registrar');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try { setLista(await api.get('/api/calibracoes')); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.'); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { api.get<any[]>('/api/equipamentos').then(setEquipamentos).catch(() => {}); }, []);

  const total = useMemo(() => lista.reduce((s, c) => s + (c.custo_centavos || 0), 0), [lista]);
  const hoje = new Date().toISOString().slice(0, 10);

  const registrar = async (form: React.FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    setErro(null); setSucesso(null);
    const fd = new FormData(form.currentTarget);
    const data = String(fd.get('data') || ''), validade = String(fd.get('validade') || '');
    if (!ehDataValida(data) || !ehDataValida(validade)) { setErro('Datas inválidas.'); return; }
    if (validade < data) { setErro('A validade não pode ser anterior à data da calibração.'); return; }
    setSalvando(true);
    try {
      const r = await api.post<any>('/api/calibracoes', {
        equipamento_id: String(fd.get('equipamento_id') || ''), data, validade,
        resultado: String(fd.get('resultado') || ''), empresa: String(fd.get('empresa') || ''),
        responsavel: String(fd.get('responsavel') || ''), observacao: String(fd.get('observacao') || ''),
        custo: String(fd.get('custo') || '0')
      });
      setUltimaCriada(r.id);
      setSucesso('Calibração registrada. A agenda de inspeção NÃO foi alterada.');
      setAbrir(false);
      if (certificado) {
        try {
          const anexoInput = document.getElementById('cert-arquivo') as HTMLInputElement | null;
          const arquivo = anexoInput?.files?.[0];
          if (arquivo) {
            const { blob } = await comprimirImagem(arquivo);
            await enviarArquivo(`/api/calibracoes/${r.id}/anexos`, blob,
              { tipo: 'certificado', nome_original: arquivo.name, legenda: 'Certificado de calibração' },
              f => setProgresso(Math.round(f * 100)));
          }
        } catch (e) { setErro('Calibração registrada, mas o certificado não pôde ser anexado: ' + (e instanceof ErroApi ? e.message : '')); }
      }
      setCertificado(null);
      await carregar();
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao registrar.'); }
    finally { setSalvando(false); }
  };

  return (
    <Layout titulo="Calibrações">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

      <div className="grade-cartoes">
        <div className="metrica metrica--vermelho"><span className="metrica__valor">{lista.filter(c => c.validade < hoje).length}</span><span className="metrica__rotulo">Vencidas</span></div>
        <div className="metrica metrica--laranja"><span className="metrica__valor">{lista.filter(c => c.validade >= hoje && c.validade <= new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)).length}</span><span className="metrica__rotulo">Vencem em 15 dias</span></div>
        <div className="metrica metrica--verde"><span className="metrica__valor">{lista.filter(c => c.resultado === 'aprovada').length}</span><span className="metrica__rotulo">Aprovadas</span></div>
        <div className="metrica"><span className="metrica__valor">{formatarMoeda(total)}</span><span className="metrica__rotulo">Custo total</span></div>
      </div>

      <Aviso tipo="info">
        As agendas de <b>calibração</b> são independentes das inspeções: concluir uma checklist
        <b> não</b> renova a validade de nenhuma calibração.
      </Aviso>

      {podeRegistrar && (
        <div className="acoes-linha" style={{ marginBottom: 12 }}>
          <button className="botao botao--verde" onClick={() => { setAbrir(true); setCertificado(null); }}>
            <Icone nome="adicionar" tam={19} /> Registrar calibração
          </button>
        </div>
      )}

      {carregando && <Carregando />}
      {!carregando && lista.length === 0 && <Vazio titulo="Nenhuma calibração registrada" />}

      {lista.map(c => {
        const vencida = c.validade < hoje;
        return (
          <div className="cartao" key={c.id} style={vencida ? { borderLeft: '4px solid #C0392B' } : undefined}>
            <div className="cartao__titulo">
              <span>{formatarData(c.data)} — {c.codigo} {c.equipamento_nome}</span>
              <Selo valor={c.resultado} />
            </div>
            <dl className="dl">
              <div className="linha-chave-valor"><dt>Validade até</dt>
                <dd><span className={vencida ? 'texto-vermelho' : ''}>{formatarData(c.validade)}{vencida ? ' (VENCIDA)' : ''}</span></dd></div>
              <div className="linha-chave-valor"><dt>Empresa</dt><dd>{c.empresa || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Responsável</dt><dd>{c.responsavel || '—'}</dd></div>
              <div className="linha-chave-valor"><dt>Custo</dt><dd>{formatarMoeda(c.custo_centavos)}</dd></div>
              {c.observacao && <div className="linha-chave-valor"><dt>Observação</dt><dd>{c.observacao}</dd></div>}
              <div className="linha-chave-valor"><dt>Certificado</dt>
                <dd>{c.certificado_anexo_id
                  ? <a href={`/arquivos/${c.certificado_anexo_id}`} target="_blank" rel="noopener noreferrer">Abrir PDF</a>
                  : '—'}</dd></div>
            </dl>
            {c.id === ultimaCriada && (
              <div style={{ marginTop: 10 }}>
                <label className="campo__rotulo" htmlFor="cert-arquivo">Anexar certificado (PDF ou foto)</label>
                <input id="cert-arquivo" className="entrada" type="file" accept="image/*,application/pdf"
                  onChange={e => setCertificado(e.target.files?.length ? { id: 'novo' } : null)} />
                {progresso > 0 && progresso < 100 && <div className="campo__ajuda">Enviando… {progresso}%</div>}
              </div>
            )}
          </div>
        );
      })}

      <Modal aberto={abrir} aoFechar={() => setAbrir(false)} titulo="Registrar calibração">
        <form onSubmit={registrar}>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="c-eq">Equipamento <span className="texto-vermelho">*</span></label>
            <select id="c-eq" name="equipamento_id" className="seletor" required>
              <option value="">Selecione…</option>
              {equipamentos.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nome}</option>)}
            </select>
          </div>
          <div className="grade-campos">
            <div className="campo"><label className="campo__rotulo" htmlFor="c-data">Data <span className="texto-vermelho">*</span></label>
              <input id="c-data" name="data" className="entrada" type="date" required /></div>
            <div className="campo"><label className="campo__rotulo" htmlFor="c-val">Validade <span className="texto-vermelho">*</span></label>
              <input id="c-val" name="validade" className="entrada" type="date" required /></div>
          </div>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="c-res">Resultado <span className="texto-vermelho">*</span></label>
            <select id="c-res" name="resultado" className="seletor" required defaultValue="aprovada">
              <option value="aprovada">Aprovada</option>
              <option value="condicional">Condicional</option>
              <option value="reprovada">Reprovada</option>
            </select>
          </div>
          <div className="grade-campos">
            <div className="campo"><label className="campo__rotulo" htmlFor="c-emp">Empresa</label>
              <input id="c-emp" name="empresa" className="entrada" /></div>
            <div className="campo"><label className="campo__rotulo" htmlFor="c-resp">Responsável</label>
              <input id="c-resp" name="responsavel" className="entrada" /></div>
            <div className="campo"><label className="campo__rotulo" htmlFor="c-custo">Custo (R$)</label>
              <input id="c-custo" name="custo" className="entrada" inputMode="decimal" placeholder="0,00" /></div>
          </div>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="c-obs">Observação</label>
            <textarea id="c-obs" name="observacao" className="area-texto" placeholder="Restrições, desvios ou condições da calibração…" />
          </div>
          <div className="acoes-linha">
            <button type="button" className="botao botao--fantasma" onClick={() => setAbrir(false)}>Cancelar</button>
            <button type="submit" className="botao botao--verde" disabled={salvando}>
              {salvando ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
}
