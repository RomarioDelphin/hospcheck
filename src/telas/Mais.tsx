// HospCheck — tela "Mais": atalhos para todas as áreas + dados da sessão
import React from 'react';
import { Link } from 'react-router-dom';
import { usarSessao } from '../sessao';
import { EtiquetaDemo, Icone, Layout, perfilRotulo } from '../componentes';

const AGRUPAMENTOS: { titulo: string; itens: { para: string; icone: string; rotulo: string; desc: string }[] }[] = [
  { titulo: 'Operação do dia', itens: [
    { para: '/escanear', icone: 'qr', rotulo: 'Escanear QR', desc: 'Abrir ficha pela etiqueta do equipamento' },
    { para: '/equipamentos', icone: 'equipamento', rotulo: 'Equipamentos', desc: 'Lista, busca e filtros' },
    { para: '/inspecoes', icone: 'check', rotulo: 'Inspeções', desc: 'Rascunhos e histórico' },
    { para: '/alertas', icone: 'alerta', rotulo: 'Alertas', desc: 'Vencimentos e ocorrências críticas' }
  ]},
  { titulo: 'Manutenção e conformidade', itens: [
    { para: '/ocorrencias', icone: 'ocorrencia', rotulo: 'Ocorrências', desc: 'Pendentes e resolvidas' },
    { para: '/manutencoes', icone: 'manutencao', rotulo: 'Manutenções', desc: 'Preventivas e corretivas com custos' },
    { para: '/calibracoes', icone: 'calibracao', rotulo: 'Calibrações', desc: 'Validades e certificados' }
  ]},
  { titulo: 'Gestão', itens: [
    { para: '/relatorios', icone: 'relatorio', rotulo: 'Relatórios', desc: 'PDFs reais e exportação CSV/Excel' },
    { para: '/config', icone: 'config', rotulo: 'Configurações', desc: 'Hospital, setores, usuários e checklists' }
  ]}
];

export function TelaMais() {
  const { usuario, sair } = usarSessao();

  return (
    <Layout titulo="Mais">
      <EtiquetaDemo />

      <div className="cartao">
        <div className="cartao__titulo"><span><Icone nome="usuario" tam={18} /> Sessão</span></div>
        <dl className="dl">
          <div className="linha-chave-valor"><dt>Nome</dt><dd>{usuario?.nome}</dd></div>
          <div className="linha-chave-valor"><dt>E-mail</dt><dd>{usuario?.email}</dd></div>
          <div className="linha-chave-valor"><dt>Perfil</dt><dd style={{ textTransform: 'capitalize' }}>{perfilRotulo(usuario?.perfil)}</dd></div>
          <div className="linha-chave-valor"><dt>Hospital</dt><dd>{usuario?.hospital_nome}</dd></div>
          <div className="linha-chave-valor"><dt>Identificador</dt><dd style={{ fontSize: '.72rem', wordBreak: 'break-all' }}>{usuario?.id}</dd></div>
        </dl>
        <Link to="/trocar-senha" className="botao botao--contorno botao--largura-total" style={{ marginTop: 12 }}>
          <Icone nome="cadeado" tam={19} /> Trocar minha senha
        </Link>
        <button className="botao botao--perigo botao--largura-total" style={{ marginTop: 8 }} onClick={() => void sair()}>
          <Icone nome="saida" tam={19} /> Sair da conta
        </button>
      </div>

      {AGRUPAMENTOS.map(g => (
        <div className="cartao" key={g.titulo}>
          <div className="cartao__titulo">{g.titulo}</div>
          <ul className="lista">
            {g.itens.map(i => (
              <li key={i.para}>
                <Link className="item-lista" to={i.para}>
                  <div className="item-lista__topo">
                    <div style={{ display: 'flex', gap: 11, minWidth: 0 }}>
                      <span style={{ color: '#0B5CAB', flex: 'none' }}><Icone nome={i.icone} tam={22} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="item-lista__titulo">{i.rotulo}</div>
                        <div className="item-lista__sub">{i.desc}</div>
                      </div>
                    </div>
                    <span style={{ color: '#CBD5E1', flex: 'none' }}>›</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="texto-pequeno centralizado">
        HospCheck v1.0.0 · fuso America/Sao_Paulo{usuario?.dados_demo ? ' · dados de demonstração fictícios' : ''}
      </p>
    </Layout>
  );
}
