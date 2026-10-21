// HospCheck — lista de inspeções com filtros
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ErroApi, formatarDataHora } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Icone, Layout, Selo, Vazio } from '../componentes';

export function TelaInspecoes() {
  const { pode } = usarSessao();
  const [params, setParams] = useSearchParams();
  const [lista, setLista] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState(params.get('status') || '');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      setLista(await api.get('/api/inspecoes' + (p.toString() ? `?${p}` : '')));
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar.'); }
    finally { setCarregando(false); }
  }, [status]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const p = new URLSearchParams(); if (status) p.set('status', status); setParams(p, { replace: true }); }, [status, setParams]);

  const contagem = (s: string) => lista.filter(i => i.status === s).length;

  return (
    <Layout titulo="Inspeções">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="grade-cartoes">
        <div className="metrica metrica--amarelo"><span className="metrica__valor">{contagem('rascunho')}</span><span className="metrica__rotulo">Rascunhos</span></div>
        <div className="metrica metrica--verde"><span className="metrica__valor">{contagem('concluida')}</span><span className="metrica__rotulo">Concluídas</span></div>
        <div className="metrica metrica--azul"><span className="metrica__valor">{contagem('retificada')}</span><span className="metrica__rotulo">Retificadas</span></div>
        <div className="metrica"><span className="metrica__valor">{lista.length}</span><span className="metrica__rotulo">Total</span></div>
      </div>

      <div className="filtros">
        {[['', 'Todas'], ['rascunho', 'Rascunhos'], ['concluida', 'Concluídas'], ['retificada', 'Retificadas']].map(([v, r]) => (
          <button key={v} className={`filtro-pilula${status === v ? ' ativo' : ''}`} onClick={() => setStatus(v!)}>{r}</button>
        ))}
      </div>

      {pode('inspecao.realizar') && (
        <div className="acoes-linha" style={{ marginBottom: 12 }}>
          <Link to="/equipamentos?situacao=vencida" className="botao botao--verde">
            <Icone nome="camera" tam={19} /> Inspecionar equipamento vencido
          </Link>
        </div>
      )}

      {carregando && <Carregando />}
      {!carregando && lista.length === 0 && (
        <Vazio titulo="Nenhuma inspeção encontrada">As inspeções realizadas pelos dispositivos aparecem aqui.</Vazio>
      )}

      <ul className="lista">
        {lista.map(i => (
          <li key={i.id}>
            <Link className="item-lista" to={`/inspecoes/${i.id}`}>
              <div className="item-lista__topo">
                <div style={{ minWidth: 0 }}>
                  <div className="item-lista__titulo">{i.equipamento_nome}</div>
                  <div className="item-lista__sub">{i.codigo} · {formatarDataHora(i.data_inicio)}</div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Selo valor={i.status} />
                  {i.resultado && <Selo valor={i.resultado} />}
                </div>
              </div>
              <div className="item-lista__meta">
                <span className="selo">Inspetor: {i.usuario_nome}</span>
                {!!i.fotos && <span className="selo selo--azul">{i.fotos} foto(s)</span>}
                {!!i.nao_conforme_count && <span className="selo selo--vermelho">{i.nao_conforme_count} não conformidade(s)</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Layout>
  );
}
