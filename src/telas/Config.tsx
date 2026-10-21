// HospCheck — configurações: hospital, setores, usuários, modelos de checklist,
// integrações (status real, sem simulação) e auditoria.
import React, { useCallback, useEffect, useState } from 'react';
import { api, ErroApi } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Icone, Layout, Modal, perfilRotulo } from '../componentes';

type Aba = 'hospital' | 'setores' | 'usuarios' | 'checklists' | 'integracoes' | 'auditoria';

export function TelaConfig() {
  const { usuario, pode, integracoes, atualizar } = usarSessao();
  const [aba, setAba] = useState<Aba>('hospital');

  return (
    <Layout titulo="Configurações">
      <EtiquetaDemo />
      <div className="abas" role="tablist">
        {([['hospital', 'Hospital'], ['setores', 'Setores'], ['usuarios', 'Usuários'],
          ['checklists', 'Checklists'], ['integracoes', 'Integrações'], ['auditoria', 'Auditoria']] as const)
          .filter(([v]) => v !== 'auditoria' || pode('auditoria.ver'))
          .filter(([v]) => (v === 'hospital' || v === 'usuarios' || v === 'setores') ? pode('config.editar') : true)
          .map(([v, r]) => (
            <button key={v} className={`aba${aba === v ? ' ativa' : ''}`} onClick={() => setAba(v)} role="tab"
              aria-selected={aba === v}>{r}</button>
          ))}
      </div>

      {aba === 'hospital' && <AbaHospital />}
      {aba === 'setores' && <AbaSetores />}
      {aba === 'usuarios' && <AbaUsuarios />}
      {aba === 'checklists' && <AbaChecklists />}
      {aba === 'integracoes' && <AbaIntegracoes />}
      {aba === 'auditoria' && pode('auditoria.ver') && <AbaAuditoria />}
      <p className="texto-pequeno centralizado">Sessão de {usuario?.nome} · perfil {perfilRotulo(usuario?.perfil)}</p>
      <input type="hidden" value={String(!!integracoes)} readOnly aria-hidden="true" />
      <span className="somente-leitor">{String(!!atualizar)}</span>
    </Layout>
  );
}

// ---------- Hospital ----------
function AbaHospital() {
  const { pode } = usarSessao();
  const [h, setH] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api.get('/api/hospitais/atual').then(setH).catch(e => setErro(e.message)); }, []);

  const salvar = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErro(null); setOk(null); setSalvando(true);
    try {
      setH(await api.patch('/api/hospitais/atual', {
        nome: h.nome, nome_fantasia: h.nome_fantasia, cnpj: h.cnpj, endereco: h.endereco, telefone: h.telefone,
        antecedencia_inspecao_dias: Number(h.antecedencia_inspecao_dias),
        antecedencia_calibracao_dias: Number(h.antecedencia_calibracao_dias),
        antecedencia_manutencao_dias: Number(h.antecedencia_manutencao_dias)
      }));
      setOk('Configurações salvas.');
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao salvar.'); }
    finally { setSalvando(false); }
  };

  if (!h) return <Carregando />;
  const set = (c: string, v: any) => setH((x: any) => ({ ...x, [c]: v }));

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ok && <Aviso tipo="sucesso">{ok}</Aviso>}
      <div className="cartao">
        <div className="cartao__titulo">Identidade do hospital</div>
        <div className="campo">
          <label className="campo__rotulo" htmlFor="h-nome">Nome <span className="texto-vermelho">*</span></label>
          <input id="h-nome" className="entrada" value={h.nome || ''} onChange={e => set('nome', e.target.value)} disabled={!pode('config.editar')} />
        </div>
        <div className="grade-campos">
          <div className="campo"><label className="campo__rotulo" htmlFor="h-fantasia">Nome fantasia</label>
            <input id="h-fantasia" className="entrada" value={h.nome_fantasia || ''} onChange={e => set('nome_fantasia', e.target.value)} disabled={!pode('config.editar')} /></div>
          <div className="campo"><label className="campo__rotulo" htmlFor="h-cnpj">CNPJ</label>
            <input id="h-cnpj" className="entrada" value={h.cnpj || ''} onChange={e => set('cnpj', e.target.value)} disabled={!pode('config.editar')} /></div>
          <div className="campo"><label className="campo__rotulo" htmlFor="h-tel">Telefone</label>
            <input id="h-tel" className="entrada" value={h.telefone || ''} onChange={e => set('telefone', e.target.value)} disabled={!pode('config.editar')} /></div>
        </div>
        <div className="campo"><label className="campo__rotulo" htmlFor="h-end">Endereço</label>
          <input id="h-end" className="entrada" value={h.endereco || ''} onChange={e => set('endereco', e.target.value)} disabled={!pode('config.editar')} /></div>
        <p className="texto-pequeno">Fuso horário fixo: <b>{h.fuso}</b> · dados de demonstração: <b>{h.dados_demo ? 'sim' : 'não'}</b></p>
      </div>

      <div className="cartao">
        <div className="cartao__titulo">Antecedência dos alertas</div>
        <div className="grade-campos grade-campos--3">
          <div className="campo"><label className="campo__rotulo" htmlFor="h-ant-i">Inspeção (dias)</label>
            <input id="h-ant-i" className="entrada" type="number" min={0} max={365} value={h.antecedencia_inspecao_dias}
              onChange={e => set('antecedencia_inspecao_dias', e.target.value)} disabled={!pode('config.editar')} /></div>
          <div className="campo"><label className="campo__rotulo" htmlFor="h-ant-c">Calibração (dias)</label>
            <input id="h-ant-c" className="entrada" type="number" min={0} max={365} value={h.antecedencia_calibracao_dias}
              onChange={e => set('antecedencia_calibracao_dias', e.target.value)} disabled={!pode('config.editar')} /></div>
          <div className="campo"><label className="campo__rotulo" htmlFor="h-ant-m">Manutenção (dias)</label>
            <input id="h-ant-m" className="entrada" type="number" min={0} max={365} value={h.antecedencia_manutencao_dias}
              onChange={e => set('antecedencia_manutencao_dias', e.target.value)} disabled={!pode('config.editar')} /></div>
        </div>
      </div>

      {pode('config.editar') && (
        <button type="submit" className="botao botao--verde botao--largura-total" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar configurações'}
        </button>
      )}
    </form>
  );
}

// ---------- Setores ----------
function AbaSetores() {
  const { pode } = usarSessao();
  const [lista, setLista] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState({ nome: '', andar: '' });

  const carregar = useCallback(() => { api.get<any[]>('/api/setores').then(setLista).catch(e => setErro(e.message)); }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const criar = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErro(null);
    if (!novo.nome.trim()) { setErro('Informe o nome do setor.'); return; }
    try { await api.post('/api/setores', novo); setNovo({ nome: '', andar: '' }); carregar(); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao criar.'); }
  };

  const alternar = async (s: any) => {
    try { await api.patch(`/api/setores/${s.id}`, { ativo: !s.ativo }); carregar(); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao atualizar.'); }
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {pode('config.editar') && (
        <div className="cartao">
          <div className="cartao__titulo">Novo setor</div>
          <form onSubmit={criar}>
            <div className="grade-campos">
              <div className="campo"><label className="campo__rotulo" htmlFor="s-nome">Nome <span className="texto-vermelho">*</span></label>
                <input id="s-nome" className="entrada" value={novo.nome} onChange={e => setNovo(n => ({ ...n, nome: e.target.value }))} placeholder="UTI Adulto" /></div>
              <div className="campo"><label className="campo__rotulo" htmlFor="s-andar">Andar</label>
                <input id="s-andar" className="entrada" value={novo.andar} onChange={e => setNovo(n => ({ ...n, andar: e.target.value }))} placeholder="Térreo" /></div>
            </div>
            <button type="submit" className="botao botao--verde botao--largura-total"><Icone nome="adicionar" tam={18} /> Criar setor</button>
          </form>
        </div>
      )}
      <ul className="lista">
        {lista.map(s => (
          <li key={s.id}>
            <div className="item-lista">
              <div className="item-lista__topo">
                <div>
                  <div className="item-lista__titulo">{s.nome}</div>
                  <div className="item-lista__sub">{s.andar || 'Sem andar informado'}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`selo selo--${s.ativo ? 'verde' : 'cinza'}`}>{s.ativo ? 'Ativo' : 'Inativo'}</span>
                  {pode('config.editar') && (
                    <button className="botao botao--fantasma botao--pequeno" onClick={() => void alternar(s)}>
                      {s.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- Usuários ----------
function AbaUsuarios() {
  const { usuario: eu } = usarSessao();
  const [lista, setLista] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [redefinir, setRedefinir] = useState<any | null>(null);
  const [novaSenha, setNovaSenha] = useState('');

  const carregar = useCallback(() => { api.get<any[]>('/api/usuarios').then(setLista).catch(e => setErro(e.message)); }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const criar = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault(); setErro(null); setOk(null);
    const fd = new FormData(ev.currentTarget);
    try {
      await api.post('/api/usuarios', {
        nome: String(fd.get('nome')), email: String(fd.get('email')), senha: String(fd.get('senha')),
        perfil: String(fd.get('perfil')), telefone: String(fd.get('telefone') || '')
      });
      setOk('Usuário criado.'); setAbrir(false); carregar();
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao criar.'); }
  };

  const alterar = async (id: string, corpo: any) => {
    setErro(null);
    try { await api.patch(`/api/usuarios/${id}`, corpo); carregar(); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao atualizar.'); }
  };

  // Senha provisória: o usuário é obrigado a trocá-la no acesso seguinte.
  const salvarNovaSenha = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErro(null); setOk(null);
    if (novaSenha.length < 8) { setErro('A senha provisória deve ter no mínimo 8 caracteres.'); return; }
    try {
      await api.patch(`/api/usuarios/${redefinir.id}`, { senha: novaSenha });
      setOk(`Senha redefinida para ${redefinir.nome}. No próximo acesso o sistema exige a troca.`);
      setRedefinir(null); setNovaSenha(''); carregar();
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao redefinir a senha.'); }
  };

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ok && <Aviso tipo="sucesso">{ok}</Aviso>}
      <div className="acoes-linha" style={{ marginBottom: 12 }}>
        <button className="botao botao--verde" onClick={() => setAbrir(true)}><Icone nome="adicionar" tam={19} /> Novo usuário</button>
      </div>
      <ul className="lista">
        {lista.map(u => (
          <li key={u.id}>
            <div className="item-lista">
              <div className="item-lista__topo">
                <div style={{ minWidth: 0 }}>
                  <div className="item-lista__titulo">{u.nome}{u.id === eu?.id ? ' (você)' : ''}</div>
                  <div className="item-lista__sub">{u.email} · {perfilRotulo(u.perfil)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`selo selo--${u.ativo ? 'verde' : 'cinza'}`}>{u.ativo ? 'Ativo' : 'Inativo'}</span>
                  {!!u.deve_trocar_senha && <span className="selo selo--laranja">senha provisória</span>}
                  <select className="seletor" style={{ width: 'auto', minHeight: 44, fontSize: '.8rem' }}
                    value={u.perfil} onChange={e => void alterar(u.id, { perfil: e.target.value })} aria-label={`Perfil de ${u.nome}`}>
                    {['administrador', 'gestor', 'inspetor', 'manutencao', 'consulta'].map(p => (
                      <option key={p} value={p}>{perfilRotulo(p)}</option>
                    ))}
                  </select>
                  {u.id !== eu?.id && (
                    <button className="botao botao--contorno botao--pequeno"
                      onClick={() => { setRedefinir(u); setNovaSenha(''); setErro(null); setOk(null); }}>
                      Redefinir senha
                    </button>
                  )}
                  {u.id !== eu?.id && (
                    <button className="botao botao--fantasma botao--pequeno" onClick={() => void alterar(u.id, { ativo: !u.ativo })}>
                      {u.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Modal aberto={abrir} aoFechar={() => setAbrir(false)} titulo="Novo usuário">
        <form onSubmit={criar}>
          <div className="campo"><label className="campo__rotulo" htmlFor="u-nome">Nome <span className="texto-vermelho">*</span></label>
            <input id="u-nome" name="nome" className="entrada" required /></div>
          <div className="campo"><label className="campo__rotulo" htmlFor="u-email">E-mail <span className="texto-vermelho">*</span></label>
            <input id="u-email" name="email" className="entrada" type="email" required /></div>
          <div className="campo"><label className="campo__rotulo" htmlFor="u-senha">Senha (mín. 8) <span className="texto-vermelho">*</span></label>
            <input id="u-senha" name="senha" className="entrada" type="password" minLength={8} required /></div>
          <div className="grade-campos">
            <div className="campo"><label className="campo__rotulo" htmlFor="u-perfil">Perfil <span className="texto-vermelho">*</span></label>
              <select id="u-perfil" name="perfil" className="seletor" required defaultValue="inspetor">
                {['administrador', 'gestor', 'inspetor', 'manutencao', 'consulta'].map(p => (
                  <option key={p} value={p}>{perfilRotulo(p)}</option>
                ))}
              </select></div>
            <div className="campo"><label className="campo__rotulo" htmlFor="u-tel">Telefone</label>
              <input id="u-tel" name="telefone" className="entrada" /></div>
          </div>
          <div className="acoes-linha">
            <button type="button" className="botao botao--fantasma" onClick={() => setAbrir(false)}>Cancelar</button>
            <button type="submit" className="botao botao--verde">Criar usuário</button>
          </div>
        </form>
      </Modal>

      <Modal aberto={!!redefinir} aoFechar={() => setRedefinir(null)}
        titulo={`Redefinir senha — ${redefinir?.nome || ''}`}>
        <form onSubmit={salvarNovaSenha}>
          <p className="texto-pequeno">
            A senha definida aqui é provisória: {redefinir?.nome} será obrigado a trocá-la no próximo acesso
            e as sessões abertas desse usuário serão encerradas.
          </p>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="u-nova-senha">Senha provisória (mín. 8) <span className="texto-vermelho">*</span></label>
            <input id="u-nova-senha" className="entrada" type="text" autoComplete="new-password"
              minLength={8} value={novaSenha} onChange={e => setNovaSenha(e.target.value)} required />
          </div>
          <div className="acoes-linha">
            <button type="button" className="botao botao--fantasma" onClick={() => setRedefinir(null)}>Cancelar</button>
            <button type="submit" className="botao botao--verde">Redefinir senha</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ---------- Modelos de checklist ----------
function AbaChecklists() {
  const { pode } = usarSessao();
  const [modelos, setModelos] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [base, setBase] = useState<any>(null);
  const [rascunho, setRascunho] = useState({ nome: '', tipo_equipamento: '', itens: [] as any[] });

  const carregar = useCallback(() => { api.get<any[]>('/api/modelos-checklist').then(setModelos).catch(e => setErro(e.message)); }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const iniciarNovo = (modeloBase?: any) => {
    if (modeloBase) {
      setBase(modeloBase);
      setRascunho({ nome: modeloBase.nome, tipo_equipamento: modeloBase.tipo_equipamento || '',
        itens: modeloBase.itens.map((i: any) => ({ enunciado: i.enunciado, exige_justificativa: !!i.exige_justificativa, exige_medicao: !!i.exige_medicao, unidade: i.unidade || '' })) });
    } else {
      setBase(null);
      setRascunho({ nome: '', tipo_equipamento: '', itens: [{ enunciado: '', exige_justificativa: false, exige_medicao: false, unidade: '' }] });
    }
    setAbrir(true); setErro(null);
  };

  const salvar = async () => {
    setErro(null);
    if (!rascunho.nome.trim()) { setErro('Informe o nome do modelo.'); return; }
    const validos = rascunho.itens.filter(i => i.enunciado.trim());
    if (!validos.length) { setErro('Adicione ao menos um item ao checklist.'); return; }
    const semUnidade = validos.find(i => i.exige_medicao && !i.unidade.trim());
    if (semUnidade) { setErro('Itens com medição numérica exigem unidade (ex.: °C, cmH₂O, V).'); return; }
    try {
      await api.post('/api/modelos-checklist', {
        nome: rascunho.nome.trim(), tipo_equipamento: rascunho.tipo_equipamento || null,
        base_modelo_id: base?.id || null, itens: validos.map(i => ({
          enunciado: i.enunciado.trim(), exige_justificativa: i.exige_justificativa,
          exige_medicao: i.exige_medicao, unidade: i.exige_medicao ? i.unidade.trim() : null }))
      });
      setOk(base ? `Nova versão criada para "${rascunho.nome}". As respostas antigas preservam o enunciado da época.` : 'Modelo criado.');
      setAbrir(false); carregar();
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao salvar.'); }
  };

  const setItem = (i: number, campo: string, valor: any) =>
    setRascunho(r => ({ ...r, itens: r.itens.map((it, j) => j === i ? { ...it, [campo]: valor } : it) }));

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ok && <Aviso tipo="sucesso">{ok}</Aviso>}
      <Aviso tipo="info">
        Modelos são <b>versionados</b>: editar um modelo cria uma nova versão sem apagar a anterior.
        As inspeções concluídas mantêm o enunciado vigente à época (histórico imutável).
      </Aviso>
      {pode('checklist.editar') && (
        <div className="acoes-linha" style={{ marginBottom: 12 }}>
          <button className="botao botao--verde" onClick={() => iniciarNovo()}><Icone nome="adicionar" tam={19} /> Novo modelo</button>
        </div>
      )}
      {modelos.map(m => (
        <div className="cartao" key={m.id}>
          <div className="cartao__titulo">
            <span>{m.nome} <span className="selo selo--azul">v{m.versao}</span></span>
            {pode('checklist.editar') && (
              <button className="botao botao--contorno botao--pequeno" onClick={() => iniciarNovo(m)}>
                Nova versão
              </button>
            )}
          </div>
          {m.tipo_equipamento && <p className="texto-pequeno">Tipo: {m.tipo_equipamento}</p>}
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: '.84rem', lineHeight: 1.7 }}>
            {m.itens.map((i: any) => (
              <li key={i.id}>
                {i.enunciado}
                {i.exige_medicao === 1 && <span className="selo selo--azul" style={{ marginLeft: 6 }}>medição {i.unidade}</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}

      <Modal aberto={abrir} aoFechar={() => setAbrir(false)} titulo={base ? `Nova versão de "${base.nome}"` : 'Novo modelo de checklist'}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {base && <Aviso tipo="atencao">A versão atual (v{base.versao}) será preservada no histórico.</Aviso>}
        <div className="campo">
          <label className="campo__rotulo" htmlFor="ck-nome">Nome do modelo <span className="texto-vermelho">*</span></label>
          <input id="ck-nome" className="entrada" value={rascunho.nome} onChange={e => setRascunho(r => ({ ...r, nome: e.target.value }))} />
        </div>
        <div className="campo">
          <label className="campo__rotulo" htmlFor="ck-tipo">Tipo de equipamento</label>
          <input id="ck-tipo" className="entrada" value={rascunho.tipo_equipamento}
            onChange={e => setRascunho(r => ({ ...r, tipo_equipamento: e.target.value }))} />
        </div>
        <div className="cartao__titulo" style={{ marginTop: 10 }}>Itens do checklist</div>
        {rascunho.itens.map((it, i) => (
          <div key={i} style={{ border: '1px solid #CBD5E1', borderRadius: 10, padding: 10, marginBottom: 9 }}>
            <div className="campo">
              <label className="campo__rotulo" htmlFor={`it-${i}`}>Item {i + 1} <span className="texto-vermelho">*</span></label>
              <input id={`it-${i}`} className="entrada" value={it.enunciado}
                onChange={e => setItem(i, 'enunciado', e.target.value)} placeholder="Ex.: Alarmes funcionando" />
            </div>
            <div className="acoes-linha" style={{ gap: 6 }}>
              <label style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={it.exige_justificativa}
                  onChange={e => setItem(i, 'exige_justificativa', e.target.checked)} /> Exige observação
              </label>
              <label style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox" checked={it.exige_medicao}
                  onChange={e => setItem(i, 'exige_medicao', e.target.checked)} /> Medição numérica
              </label>
              {it.exige_medicao && (
                <input className="entrada" style={{ width: 110, minHeight: 44, fontSize: '.82rem' }}
                  value={it.unidade} onChange={e => setItem(i, 'unidade', e.target.value)} placeholder="Unidade (°C)" />
              )}
              <button type="button" className="botao botao--fantasma botao--pequeno"
                onClick={() => setRascunho(r => ({ ...r, itens: r.itens.filter((_, j) => j !== i) }))}>Remover</button>
            </div>
          </div>
        ))}
        <button type="button" className="botao botao--contorno botao--largura-total"
          onClick={() => setRascunho(r => ({ ...r, itens: [...r.itens, { enunciado: '', exige_justificativa: false, exige_medicao: false, unidade: '' }] }))}>
          <Icone nome="adicionar" tam={17} /> Adicionar item
        </button>
        <div className="acoes-linha" style={{ marginTop: 12 }}>
          <button className="botao botao--fantasma" onClick={() => setAbrir(false)}>Cancelar</button>
          <button className="botao botao--verde" onClick={() => void salvar()}>
            {base ? 'Criar nova versão' : 'Criar modelo'}
          </button>
        </div>
      </Modal>
    </>
  );
}

// ---------- Integrações ----------
function AbaIntegracoes() {
  const { integracoes, pode } = usarSessao();
  const g = integracoes?.google;
  const e = integracoes?.email;
  const [resumo, setResumo] = useState<any>(null);
  const [executando, setExecutando] = useState(false);

  const executar = async () => {
    setExecutando(true);
    try { setResumo(await api.post('/api/integracoes/email/executar')); }
    catch { setResumo({ erro: 'Falha ao executar a rotina.' }); }
    finally { setExecutando(false); }
  };

  return (
    <>
      <div className="cartao">
        <div className="cartao__titulo">
          <span><Icone nome="nuvem" tam={18} /> Google Planilhas e Drive</span>
          <span className={`selo selo--${g?.status === 'conectado' ? 'verde' : 'cinza'}`}>
            {g?.status === 'conectado' ? 'Conectado' : 'Desconectado'}
          </span>
        </div>
        <Aviso tipo="atencao">
          <strong>Status: {g?.status === 'conectado' ? 'conectado' : 'desconectado'}</strong>
          Nenhuma sincronização é simulada. Sem credenciais autorizadas no servidor, o HospCheck
          usa o banco interno SQLite como fonte operacional e mantém o espelhamento Google desligado.
        </Aviso>
        {!!g?.pendencias?.length && (
          <>
            <div className="cartao__titulo" style={{ marginTop: 10 }}>Pendências</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '.84rem', lineHeight: 1.7 }}>
              {g.pendencias.map((p: string, i: number) => <li key={i}>{p}</li>)}
            </ul>
          </>
        )}
        {!!g?.proximos_passos?.length && (
          <>
            <div className="cartao__titulo" style={{ marginTop: 12 }}>Como habilitar (no servidor)</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: '.84rem', lineHeight: 1.7 }}>
              {g.proximos_passos.map((p: string, i: number) => <li key={i}>{p}</li>)}
            </ol>
          </>
        )}
        <p className="texto-pequeno" style={{ marginTop: 10 }}>
          Escopos planejados: <code style={{ fontSize: '.7rem', wordBreak: 'break-all' }}>{g?.escopos}</code>
        </p>
        <p className="texto-pequeno">
          As credenciais ficam <b>apenas no backend</b> (variáveis de ambiente). O frontend nunca
          recebe chave ou senha, e nenhuma delas deve ser colada no chat.
        </p>
      </div>

      <div className="cartao">
        <div className="cartao__titulo">
          <span>Resumo diário por e-mail</span>
          <span className={`selo selo--${e?.status === 'enviado' ? 'verde' : 'laranja'}`}>
            {e?.status === 'enviado' ? 'Enviado' : e?.status === 'falha' ? 'Falha' : 'Pendente'}
          </span>
        </div>
        <p className="texto-pequeno">
          {e?.rotino || e?.rotina || 'Executada no servidor, mesmo com o aplicativo fechado.'}
        </p>
        {!!e?.pendencias?.length && (
          <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: '.84rem', lineHeight: 1.7 }}>
            {e.pendencias.map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        )}
        {pode('config.editar') && (
          <button className="botao botao--contorno" onClick={() => void executar()} disabled={executando}>
            {executando ? 'Executando…' : 'Executar rotina agora'}
          </button>
        )}
        {resumo && (
          <pre style={{ fontSize: '.7rem', background: '#EEF3F8', padding: 10, borderRadius: 8, overflowX: 'auto', marginTop: 10 }}>
            {JSON.stringify(resumo, null, 2)}
          </pre>
        )}
      </div>

      <div className="cartao">
        <div className="cartao__titulo">Banco de dados interno</div>
        <p className="texto-pequeno">
          Fonte operacional: SQLite em <code>data/hospcheck.db</code>, com anexos privados em
          <code> data/uploads</code> servidos somente com autenticação e sem cache público.
          A exportação de backup está em Relatórios/Configurações (sem senhas).
        </p>
      </div>
    </>
  );
}

// ---------- Auditoria ----------
function AbaAuditoria() {
  const [lista, setLista] = useState<any[]>([]);
  const [entidade, setEntidade] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams({ limite: '200' });
    if (entidade) p.set('entidade', entidade);
    api.get<any[]>(`/api/auditoria?${p}`).then(setLista).catch(e => setErro(e.message));
  }, [entidade]);

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="filtros">
        {[['', 'Todas'], ['equipamento', 'Equipamentos'], ['inspecao', 'Inspeções'],
          ['ocorrencia', 'Ocorrências'], ['manutencao', 'Manutenções'], ['calibracao', 'Calibrações'],
          ['usuario', 'Usuários']].map(([v, r]) => (
          <button key={v} className={`filtro-pilula${entidade === v ? ' ativo' : ''}`} onClick={() => setEntidade(v!)}>{r}</button>
        ))}
      </div>
      <ul className="lista">
        {lista.map(a => (
          <li key={a.id}>
            <div className="item-lista" style={{ cursor: 'pointer' }} onClick={() => setAbrindo(abrindo === a.id ? null : a.id)}>
              <div className="item-lista__topo">
                <div style={{ minWidth: 0 }}>
                  <div className="item-lista__titulo">{a.acao}</div>
                  <div className="item-lista__sub">{a.entidade} · {a.usuario_nome || 'sistema'} · {new Date(a.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
                </div>
                <span className="selo selo--azul">{abrindo === a.id ? 'ocultar' : 'detalhes'}</span>
              </div>
              {abrindo === a.id && (
                <pre style={{ fontSize: '.68rem', background: '#EEF3F8', padding: 9, borderRadius: 8, overflowX: 'auto', marginTop: 9 }}>
                  {JSON.stringify({ antes: a.dados_antes && JSON.parse(a.dados_antes), depois: a.dados_depois && JSON.parse(a.dados_depois) }, null, 2)}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!lista.length && <p className="texto-pequeno centralizado">Nenhum registro de auditoria para este filtro.</p>}
    </>
  );
}
