// HospCheck — centro de alertas: vencimentos, calibrações, manutenção, ocorrências e interdições
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErroApi, formatarData } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Carregando, EtiquetaDemo, Layout, Vazio } from '../componentes';

interface Alerta {
  id: string; tipo: string; nivel: string; titulo: string; mensagem: string;
  equipamento_id: string; equipamento_nome: string; setor?: string;
  referencia?: string; atraso_dias: number; antecedencia_dias?: number;
}

const NIVEIS = [
  { v: 'critico', rotulo: 'Críticos', cor: '#C0392B' },
  { v: 'atencao', rotulo: 'Atenção', cor: '#C77A0A' },
  { v: 'informativo', rotulo: 'Informativos', cor: '#0B5CAB' }
];

export function TelaAlertas() {
  const { pode } = usarSessao();
  const navegar = useNavigate();
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [nivel, setNivel] = useState('');
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [executandoEmail, setExecutandoEmail] = useState(false);
  const [resumoEmail, setResumoEmail] = useState<any>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const r = await api.get<any>('/api/alertas');
      setDados(r);
      setSalvoEm(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao carregar alertas.'); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const executarResumo = async () => {
    setExecutandoEmail(true); setResumoEmail(null);
    try { setResumoEmail(await api.post('/api/integracoes/email/executar')); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : 'Falha ao executar a rotina.'); }
    finally { setExecutandoEmail(false); }
  };

  const alertas: Alerta[] = (dados?.alertas || []).filter((a: Alerta) => !nivel || a.nivel === nivel);
  const porNivel = (n: string) => (dados?.alertas || []).filter((a: Alerta) => a.nivel === n).length;

  return (
    <Layout titulo="Centro de alertas">
      <EtiquetaDemo />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="cartao">
        <div className="cartao__titulo">
          <span>Alertas ativos</span>
          <button className="botao botao--fantasma botao--pequeno" onClick={() => void carregar()}>Atualizar</button>
        </div>
        <div className="grade-campos">
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo">Antecedência de inspeção</label>
            <div className="negrito">{dados?.antecedencias?.inspecao_dias} dia(s)</div>
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo">Antecedência de calibração</label>
            <div className="negrito">{dados?.antecedencias?.calibracao_dias} dia(s)</div>
          </div>
          <div className="campo" style={{ marginBottom: 0 }}>
            <label className="campo__rotulo">Antecedência de manutenção</label>
            <div className="negrito">{dados?.antecedencias?.manutencao_dias} dia(s)</div>
          </div>
        </div>
        <p className="texto-pequeno" style={{ marginTop: 8 }}>
          As antecedências são configuráveis pelo administrador em Configurações.
          {salvoEm && <> Última verificação: {salvoEm}.</>}
        </p>
      </div>

      <div className="filtros">
        <button className={`filtro-pilula${nivel === '' ? ' ativo' : ''}`} onClick={() => setNivel('')}>
          Todos ({dados?.total || 0})
        </button>
        {NIVEIS.map(n => (
          <button key={n.v} className={`filtro-pilula${nivel === n.v ? ' ativo' : ''}`} onClick={() => setNivel(n.v)}>
            {n.rotulo} ({porNivel(n.v)})
          </button>
        ))}
      </div>

      {carregando && <Carregando />}
      {!carregando && alertas.length === 0 && (
        <Vazio titulo="Nenhum alerta neste filtro">Nenhum item exige atenção no momento.</Vazio>
      )}

      {alertas.map(a => {
        const cor = a.nivel === 'critico' ? '#C0392B' : a.nivel === 'atencao' ? '#C77A0A' : '#0B5CAB';
        const fundo = a.nivel === 'critico' ? '#FBEAE8' : a.nivel === 'atencao' ? '#FDF2E0' : '#E8F1FA';
        return (
          <div key={a.id} className="cartao" style={{ borderLeft: `4px solid ${cor}`, background: fundo, cursor: 'pointer' }}
            role="button" tabIndex={0}
            onClick={() => a.equipamento_id && navegar(`/equipamentos/${a.equipamento_id}`)}
            onKeyDown={e => { if (e.key === 'Enter' && a.equipamento_id) navegar(`/equipamentos/${a.equipamento_id}`); }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '.92rem', color: cor, marginBottom: 4 }}>{a.titulo}</div>
                <div style={{ fontSize: '.83rem', color: '#3C4C5C' }}>{a.mensagem}</div>
              </div>
              <span className="selo" style={{ background: cor, color: '#fff', flex: 'none' }}>
                {a.nivel === 'critico' ? 'CRÍTICO' : a.nivel === 'atencao' ? 'ATENÇÃO' : 'INFO'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {a.setor && <span className="selo selo--azul">{a.setor}</span>}
              {a.referencia && <span className="selo">Referência: {formatarData(a.referencia)}</span>}
              {!!a.atraso_dias && <span className="selo selo--vermelho">Atraso: {a.atraso_dias} dia(s)</span>}
              {!!a.antecedencia_dias && <span className="selo">Alerta com {a.antecedencia_dias} dia(s) de antecedência</span>}
            </div>
          </div>
        );
      })}

      {pode('config.editar') && (
        <div className="cartao">
          <div className="cartao__titulo"><span>Resumo por e-mail (rotina do servidor)</span></div>
          <p className="texto-pequeno">
            A rotina roda no servidor mesmo com o aplicativo fechado. Sem provedor configurado,
            os resumos ficam <b>pendentes</b> — nenhum envio é simulado.
          </p>
          <button className="botao botao--contorno" onClick={() => void executarResumo()} disabled={executandoEmail}>
            {executandoEmail ? 'Executando…' : 'Executar rotina agora'}
          </button>
          {resumoEmail && (
            <pre style={{ fontSize: '.72rem', background: '#EEF3F8', padding: 10, borderRadius: 8, overflowX: 'auto', marginTop: 10 }}>
              {JSON.stringify(resumoEmail, null, 2)}
            </pre>
          )}
        </div>
      )}
    </Layout>
  );
}
