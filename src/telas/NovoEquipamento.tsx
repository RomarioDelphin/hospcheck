// HospCheck — cadastro e edição de equipamento (validação e unicidade no servidor)
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ErroApi, ehDataValida, hojeISO } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, Layout, Voltar } from '../componentes';

const VAZIO = { codigo: '', nome: '', tipo: '', marca: '', modelo: '', serie: '', patrimonio: '',
  setor_id: '', localizacao: '', responsavel_id: '', periodicidade: 'quinzenal', data_inicial: hojeISO(), status: 'operacional' };

export function TelaNovoEquipamento() {
  const { id } = useParams();
  const editando = !!id;
  const navegar = useNavigate();
  const { pode } = usarSessao();
  const [f, setF] = useState({ ...VAZIO });
  const [opcoes, setOpcoes] = useState<any>({ setores: [], usuarios: [], tipos: [], status: [], periodicidades: [] });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api.get('/api/equipamentos/opcoes').then(setOpcoes).catch(() => {}); }, []);

  useEffect(() => {
    if (!editando) { setCarregando(false); return; }
    api.get<{ equipamento: any }>('/api/equipamentos/' + id).then(resp => {
      const e = resp.equipamento;
      setF({ codigo: e.codigo, nome: e.nome, tipo: e.tipo, marca: e.marca || '', modelo: e.modelo || '',
        serie: e.serie || '', patrimonio: e.patrimonio || '', setor_id: e.setor_id || '',
        localizacao: e.localizacao || '', responsavel_id: e.responsavel_id || '',
        periodicidade: e.periodicidade, data_inicial: e.data_inicial, status: e.status });
    }).catch(e => setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.'))
      .finally(() => setCarregando(false));
  }, [id, editando]);

  const set = (campo: string, valor: string) => {
    setF(v => ({ ...v, [campo]: valor }));
    setErrosCampo(e => ({ ...e, [campo]: '' }));
  };

  const validar = (): boolean => {
    const e: Record<string, string> = {};
    if (!f.codigo.trim()) e.codigo = 'Código é obrigatório.';
    if (!f.nome.trim()) e.nome = 'Nome é obrigatório.';
    if (!f.tipo.trim()) e.tipo = 'Instrumento/tipo é obrigatório.';
    if (!ehDataValida(f.data_inicial)) e.data_inicial = 'Informe uma data válida (AAAA-MM-DD).';
    if (!['semanal', 'quinzenal', 'mensal'].includes(f.periodicidade)) e.periodicidade = 'Periodicidade inválida.';
    setErrosCampo(e);
    return Object.keys(e).length === 0;
  };

  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErro(null);
    if (!validar()) return;
    setSalvando(true);
    try {
      const corpo: any = { ...f, setor_id: f.setor_id || null, responsavel_id: f.responsavel_id || null };
      if (editando) await api.patch(`/api/equipamentos/${id}`, corpo);
      else await api.post('/api/equipamentos', corpo);
      navegar(`/equipamentos/${editando ? id : ''}`.replace(/\/$/, '') || '/equipamentos');
    } catch (ex) {
      if (ex instanceof ErroApi) {
        setErro(ex.message);
        if (/código/i.test(ex.message)) setErrosCampo({ codigo: ex.message });
      } else setErro('Falha ao salvar.');
    } finally { setSalvando(false); }
  };

  if (carregando) return <Layout titulo={editando ? 'Editar' : 'Novo equipamento'}><Carregando /></Layout>;

  return (
    <Layout titulo={editando ? 'Editar equipamento' : 'Novo equipamento'}>
      <Voltar para={editando ? `/equipamentos/${id}` : '/equipamentos'} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {!editando && !pode('equipamento.criar') && (
        <Aviso tipo="atencao">Seu perfil não tem permissão para cadastrar equipamentos.</Aviso>
      )}
      {editando && !pode('equipamento.editar') && (
        <Aviso tipo="atencao">Seu perfil pode visualizar, mas não editar equipamentos.</Aviso>
      )}

      <form onSubmit={salvar} noValidate>
        <div className="cartao">
          <div className="cartao__titulo">Identificação</div>
          <div className="grade-campos">
            <div className="campo">
              <label className="campo__rotulo" htmlFor="codigo">Código único <span className="texto-vermelho">*</span></label>
              <input id="codigo" className="entrada" value={f.codigo} onChange={e => set('codigo', e.target.value)}
                placeholder="EQ-0001" aria-invalid={!!errosCampo.codigo} disabled={editando && !pode('equipamento.editar')} />
              {errosCampo.codigo && <div className="campo__erro">{errosCampo.codigo}</div>}
              {editando && <div className="campo__ajuda">O código é fixo após a criação para manter a URL do QR estável.</div>}
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="nome">Nome <span className="texto-vermelho">*</span></label>
              <input id="nome" className="entrada" value={f.nome} onChange={e => set('nome', e.target.value)}
                placeholder="Monitor Multiparâmetros" aria-invalid={!!errosCampo.nome} />
              {errosCampo.nome && <div className="campo__erro">{errosCampo.nome}</div>}
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="tipo">Instrumento/Tipo <span className="texto-vermelho">*</span></label>
              <input id="tipo" className="entrada" list="lista-tipos" value={f.tipo} onChange={e => set('tipo', e.target.value)}
                placeholder="Monitor Multiparâmetros" aria-invalid={!!errosCampo.tipo} />
              <datalist id="lista-tipos">{opcoes.tipos.map((t: string) => <option key={t} value={t} />)}</datalist>
              {errosCampo.tipo && <div className="campo__erro">{errosCampo.tipo}</div>}
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="marca">Marca</label>
              <input id="marca" className="entrada" value={f.marca} onChange={e => set('marca', e.target.value)} />
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="modelo">Modelo</label>
              <input id="modelo" className="entrada" value={f.modelo} onChange={e => set('modelo', e.target.value)} />
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="serie">Número de série</label>
              <input id="serie" className="entrada" value={f.serie} onChange={e => set('serie', e.target.value)} />
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="patrimonio">Patrimônio</label>
              <input id="patrimonio" className="entrada" value={f.patrimonio} onChange={e => set('patrimonio', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="cartao">
          <div className="cartao__titulo">Localização e responsabilidade</div>
          <div className="grade-campos">
            <div className="campo">
              <label className="campo__rotulo" htmlFor="setor">Setor</label>
              <select id="setor" className="seletor" value={f.setor_id} onChange={e => set('setor_id', e.target.value)}>
                <option value="">Selecione…</option>
                {opcoes.setores.map((s: any) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="local">Localização específica</label>
              <input id="local" className="entrada" value={f.localizacao} onChange={e => set('localizacao', e.target.value)}
                placeholder="Leito 03, sala ou bancada" />
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="resp">Responsável</label>
              <select id="resp" className="seletor" value={f.responsavel_id} onChange={e => set('responsavel_id', e.target.value)}>
                <option value="">Selecione…</option>
                {opcoes.usuarios.map((u: any) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="status">Status operacional</label>
              <select id="status" className="seletor" value={f.status} onChange={e => set('status', e.target.value)}
                disabled={!pode('equipamento.status')}>
                {opcoes.status.map((s: string) => (
                  <option key={s} value={s}>
                    {s === 'operacional' ? 'Operacional' : s === 'restricao' ? 'Com restrição' : s === 'interditado' ? 'Interditado' : s === 'manutencao' ? 'Em manutenção' : 'Desativado'}
                  </option>
                ))}
              </select>
              {!pode('equipamento.status') && <div className="campo__ajuda">Somente administrador/gestor alteram o status.</div>}
            </div>
          </div>
        </div>

        <div className="cartao">
          <div className="cartao__titulo">Agenda de inspeção</div>
          <div className="grade-campos">
            <div className="campo">
              <label className="campo__rotulo" htmlFor="periodicidade">Periodicidade <span className="texto-vermelho">*</span></label>
              <select id="periodicidade" className="seletor" value={f.periodicidade} onChange={e => set('periodicidade', e.target.value)}>
                <option value="semanal">Semanal (7 dias)</option>
                <option value="quinzenal">Quinzenal (15 dias)</option>
                <option value="mensal">Mensal (calendário)</option>
              </select>
            </div>
            <div className="campo">
              <label className="campo__rotulo" htmlFor="data-inicial">Data inicial <span className="texto-vermelho">*</span></label>
              <input id="data-inicial" className="entrada" type="date" value={f.data_inicial}
                onChange={e => set('data_inicial', e.target.value)} aria-invalid={!!errosCampo.data_inicial} />
              {errosCampo.data_inicial && <div className="campo__erro">{errosCampo.data_inicial}</div>}
              <div className="campo__ajuda">Base do primeiro vencimento.</div>
            </div>
          </div>
          <p className="texto-pequeno">
            As agendas de <b>calibração</b> e <b>manutenção</b> são criadas automaticamente com periodicidades
            próprias (12 e 6 meses) e são gerenciadas separadamente em suas telas.
          </p>
        </div>

        <div className="acoes-linha">
          <button type="button" className="botao botao--fantasma"
            onClick={() => navegar(editando ? `/equipamentos/${id}` : '/equipamentos')}>Cancelar</button>
          <button type="submit" className="botao botao--verde" disabled={salvando}>
            {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Cadastrar equipamento')}
          </button>
        </div>
      </form>
    </Layout>
  );
}
