// HospCheck — manutenções preventivas/corretivas com valores em centavos e totais derivados
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ErroApi, ehDataValida, formatarData, formatarMoeda } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Icone, Layout, Modal, Selo, Vazio } from '../componentes';

// Converte "1234,56" ou "1234.56" em centavos (inteiro), sem arredondamento fantasma.
function paraCentavos(valor: string): number | null {
  if (!valor || !valor.trim()) return 0;
  const limpo = valor.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function TelaManutencoes() {
  const { pode } = usarSessao();
  const [params] = useSearchParams();
  const [lista, setLista] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState(params.get('tipo') || '');
  const [salvando, setSalvando] = useState(false);

  const podeRegistrar = pode('manutencao.registrar');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const p = new URLSearchParams();
      if (filtroTipo) p.set('tipo', filtroTipo);
      setLista(await api.get('/api/manutencoes' + (p.toString() ? `?${p}` : '')));
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.'); }
    finally { setCarregando(false); }
  }, [filtroTipo]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { api.get<any[]>('/api/equipamentos').then(setEquipamentos).catch(() => {}); }, []);

  const total = useMemo(() => lista.reduce((s, m) => s + (m.total_centavos || 0), 0), [lista]);
  const porTipo = useMemo(() => ({
    preventiva: lista.filter(m => m.tipo === 'preventiva').reduce((s, m) => s + m.total_centavos, 0),
    corretiva: lista.filter(m => m.tipo === 'corretiva').reduce((s, m) => s + m.total_centavos, 0)
  }), [lista]);

  const registrar = async (form: React.FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    setErro(null); setSucesso(null);
    const fd = new FormData(form.currentTarget);
    const pecas = paraCentavos(String(fd.get('pecas') || ''));
    const mao = paraCentavos(String(fd.get('mao_obra') || ''));
    const outros = paraCentavos(String(fd.get('outros') || ''));
    if ([pecas, mao, outros].some(v => v === null)) { setErro('Valores monetários inválidos (use números ≥ 0).'); return; }

    const data = String(fd.get('data') || '');
    const proxima = String(fd.get('proxima_data') || '');
    if (!ehDataValida(data)) { setErro('Data da manutenção inválida.'); return; }
    if (proxima && !ehDataValida(proxima)) { setErro('Próxima data inválida.'); return; }

    setSalvando(true);
    try {
      const r = await api.post<any>('/api/manutencoes', {
        equipamento_id: String(fd.get('equipamento_id') || ''),
        tipo: String(fd.get('tipo') || ''),
        data, empresa: String(fd.get('empresa') || ''), profissional: String(fd.get('profissional') || ''),
        descricao: String(fd.get('descricao') || ''),
        pecas_centavos: pecas || 0, mao_obra_centavos: mao || 0, outros_centavos: outros || 0,
        proxima_data: proxima || null
      });
      setSucesso(`Manutenção registrada. Total ${formatarMoeda(r.total_centavos)}.`);
      setAbrir(false); await carregar();
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao registrar.'); }
    finally { setSalvando(false); }
  };

  return (
    <Layout titulo="Manutenções">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

      <div className="grade-cartoes">
        <div className="metrica metrica--cinza"><span className="metrica__valor">{formatarMoeda(porTipo.preventiva)}</span><span className="metrica__rotulo">Preventivas</span></div>
        <div className="metrica metrica--laranja"><span className="metrica__valor">{formatarMoeda(porTipo.corretiva)}</span><span className="metrica__rotulo">Corretivas</span></div>
        <div className="metrica metrica--verde"><span className="metrica__valor">{formatarMoeda(total)}</span><span className="metrica__rotulo">Total ({lista.length} registros)</span></div>
      </div>

      <div className="filtros">
        {[['', 'Todas'], ['preventiva', 'Preventivas'], ['corretiva', 'Corretivas']].map(([v, r]) => (
          <button key={v} className={`filtro-pilula${filtroTipo === v ? ' ativo' : ''}`} onClick={() => setFiltroTipo(v!)}>{r}</button>
        ))}
      </div>

      {podeRegistrar && (
        <div className="acoes-linha" style={{ marginBottom: 12 }}>
          <button className="botao botao--verde" onClick={() => setAbrir(true)}>
            <Icone nome="adicionar" tam={19} /> Registrar manutenção
          </button>
        </div>
      )}

      {carregando && <Carregando />}
      {!carregando && lista.length === 0 && <Vazio titulo="Nenhuma manutenção registrada no período" />}

      {lista.map(m => (
        <div className="cartao" key={m.id}>
          <div className="cartao__titulo">
            <span>{formatarData(m.data)} — {m.codigo} {m.equipamento_nome}</span>
            <Selo valor={m.tipo} />
          </div>
          <p style={{ marginBottom: 6 }}>{m.descricao}</p>
          <dl className="dl">
            <div className="linha-chave-valor"><dt>Empresa/Profissional</dt><dd>{m.empresa || '—'} / {m.profissional || '—'}</dd></div>
            <div className="linha-chave-valor"><dt>Peças</dt><dd>{formatarMoeda(m.pecas_centavos)}</dd></div>
            <div className="linha-chave-valor"><dt>Mão de obra</dt><dd>{formatarMoeda(m.mao_obra_centavos)}</dd></div>
            <div className="linha-chave-valor"><dt>Outros</dt><dd>{formatarMoeda(m.outros_centavos)}</dd></div>
            <div className="linha-chave-valor"><dt className="negrito">Total (derivado)</dt><dd className="texto-verde">{formatarMoeda(m.total_centavos)}</dd></div>
            <div className="linha-chave-valor"><dt>Próxima data</dt><dd>{formatarData(m.proxima_data)}</dd></div>
            <div className="linha-chave-valor"><dt>Comprovantes/laudos</dt><dd>{m.anexos || 0}</dd></div>
          </dl>
        </div>
      ))}

      <Modal aberto={abrir} aoFechar={() => setAbrir(false)} titulo="Registrar manutenção">
        <form onSubmit={registrar}>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="m-eq">Equipamento <span className="texto-vermelho">*</span></label>
            <select id="m-eq" name="equipamento_id" className="seletor" required>
              <option value="">Selecione…</option>
              {equipamentos.map(e => <option key={e.id} value={e.id}>{e.codigo} — {e.nome}</option>)}
            </select>
          </div>
          <div className="grade-campos">
            <div className="campo">
              <label className="campo__rotulo" htmlFor="m-tipo">Tipo <span className="texto-vermelho">*</span></label>
              <select id="m-tipo" name="tipo" className="seletor" required defaultValue="preventiva">
                <option value="preventiva">Preventiva</option>
                <option value="corretiva">Corretiva</option>
              </select>
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="m-data">Data <span className="texto-vermelho">*</span></label>
              <input id="m-data" name="data" className="entrada" type="date" required />
            </div>
          </div>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="m-desc">Descrição <span className="texto-vermelho">*</span></label>
            <textarea id="m-desc" name="descricao" className="area-texto" required
              placeholder="Serviço executado, peças trocadas, testes realizados…" />
          </div>
          <div className="grade-campos">
            <div className="campo"><label className="campo__rotulo" htmlFor="m-emp">Empresa</label>
              <input id="m-emp" name="empresa" className="entrada" /></div>
            <div className="campo"><label className="campo__rotulo" htmlFor="m-prof">Profissional</label>
              <input id="m-prof" name="profissional" className="entrada" /></div>
          </div>
          <fieldset style={{ border: '1px solid #CBD5E1', borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <legend style={{ fontSize: '.8rem', fontWeight: 700, color: '#3C4C5C', padding: '0 5px' }}>Valores (R$)</legend>
            <div className="grade-campos">
              <div className="campo"><label className="campo__rotulo" htmlFor="m-pecas">Peças</label>
                <input id="m-pecas" name="pecas" className="entrada" inputMode="decimal" placeholder="0,00" /></div>
              <div className="campo"><label className="campo__rotulo" htmlFor="m-mao">Mão de obra</label>
                <input id="m-mao" name="mao_obra" className="entrada" inputMode="decimal" placeholder="0,00" /></div>
              <div className="campo"><label className="campo__rotulo" htmlFor="m-outros">Outros</label>
                <input id="m-outros" name="outros" className="entrada" inputMode="decimal" placeholder="0,00" /></div>
              <div className="campo"><label className="campo__rotulo" htmlFor="m-prox">Próxima data</label>
                <input id="m-prox" name="proxima_data" className="entrada" type="date" /></div>
            </div>
          </fieldset>
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
