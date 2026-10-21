// HospCheck — roteamento e guarda de autenticação
import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ProvedorSessao, usarSessao } from './sessao';
import { Carregando, Layout, EtiquetaDemo } from './componentes';
import { TelaLogin } from './telas/Login';
import { TelaDashboard } from './telas/Dashboard';
import { TelaEquipamentos } from './telas/Equipamentos';
import { TelaFicha } from './telas/FichaEquipamento';
import { TelaNovoEquipamento } from './telas/NovoEquipamento';
import { TelaInspecoes } from './telas/Inspecoes';
import { TelaInspecao } from './telas/Inspecao';
import { TelaEscanear } from './telas/Escanear';
import { TelaOcorrencias } from './telas/Ocorrencias';
import { TelaManutencoes } from './telas/Manutencoes';
import { TelaCalibracoes } from './telas/Calibracoes';
import { TelaAlertas } from './telas/Alertas';
import { TelaRelatorios } from './telas/Relatorios';
import { TelaConfig } from './telas/Config';
import { TelaMais } from './telas/Mais';
import { TelaTrocarSenha } from './telas/TrocarSenha';

/** Guarda de rota: exige sessão e, opcionalmente, uma permissão. */
function Protegida({ acao, children }: { acao?: string; children: React.ReactNode }) {
  const { usuario, carregando, pode } = usarSessao();
  const local = useLocation();

  if (carregando) return <Carregando texto="Verificando sessão…" />;
  if (!usuario) {
    const destino = encodeURIComponent(local.pathname + local.search);
    return <Navigate to={`/entrar?destino=${destino}`} replace />;
  }
  // Senha provisória: nada é liberado antes da troca (o servidor também bloqueia a API)
  if (usuario.deve_trocar_senha && local.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  if (acao && !pode(acao)) {
    return (
      <Layout titulo="Acesso restrito">
        <div className="vazio">
          <strong>Sem permissão para esta área</strong>
          O perfil <b>{usuario.perfil}</b> não tem acesso a esta funcionalidade. Solicite ao administrador do hospital.
        </div>
      </Layout>
    );
  }
  return <>{children}</>;
}

/** Rota /e/:id — destino do QR Code. Autentica preservando o destino. */
function DestinoQR() {
  const { usuario, carregando } = usarSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const id = (local.pathname.split('/')[2] || '');

  useEffect(() => {
    if (carregando || !usuario) return;
    // O QR carrega apenas o identificador; os dados são buscados autenticado.
    navegar(`/equipamentos/${encodeURIComponent(id)}`, { replace: true });
  }, [carregando, usuario, id, navegar]);

  if (carregando) return <Carregando texto="Abrindo equipamento do QR…" />;
  if (!usuario) {
    const destino = encodeURIComponent(`/e/${id}`);
    return <Navigate to={`/entrar?destino=${destino}`} replace />;
  }
  return <Carregando texto="Abrindo equipamento…" />;
}

export function Aplicacao() {
  return (
    <ProvedorSessao>
      <Rotas />
    </ProvedorSessao>
  );
}

function Rotas() {
  return (
    <Routes>
      <Route path="/entrar" element={<TelaLogin />} />
      <Route path="/e/:id" element={<DestinoQR />} />

      <Route path="/" element={<Protegida><TelaDashboard /></Protegida>} />
      <Route path="/equipamentos" element={<Protegida><TelaEquipamentos /></Protegida>} />
      <Route path="/equipamentos/novo" element={<Protegida acao="equipamento.criar"><TelaNovoEquipamento /></Protegida>} />
      <Route path="/equipamentos/:id" element={<Protegida><TelaFicha /></Protegida>} />
      <Route path="/equipamentos/:id/editar" element={<Protegida acao="equipamento.editar"><TelaNovoEquipamento /></Protegida>} />
      <Route path="/equipamentos/:equipamentoId/inspecionar" element={<Protegida acao="inspecao.realizar"><TelaInspecao /></Protegida>} />
      <Route path="/inspecoes" element={<Protegida><TelaInspecoes /></Protegida>} />
      <Route path="/inspecoes/:inspecaoId" element={<Protegida><TelaInspecao /></Protegida>} />
      <Route path="/escanear" element={<Protegida><TelaEscanear /></Protegida>} />
      <Route path="/ocorrencias" element={<Protegida><TelaOcorrencias /></Protegida>} />
      <Route path="/manutencoes" element={<Protegida><TelaManutencoes /></Protegida>} />
      <Route path="/calibracoes" element={<Protegida><TelaCalibracoes /></Protegida>} />
      <Route path="/alertas" element={<Protegida><TelaAlertas /></Protegida>} />
      <Route path="/relatorios" element={<Protegida acao="relatorio.gerar"><TelaRelatorios /></Protegida>} />
      <Route path="/config" element={<Protegida acao="config.editar"><TelaConfig /></Protegida>} />
      <Route path="/mais" element={<Protegida><TelaMais /></Protegida>} />
      <Route path="/trocar-senha" element={<Protegida><TelaTrocarSenha /></Protegida>} />

      <Route path="*" element={<Protegida><PaginaNaoEncontrada /></Protegida>} />
    </Routes>
  );
}

function PaginaNaoEncontrada() {
  return (
    <Layout titulo="Não encontrado">
      <div className="vazio">
        <strong>Página não encontrada</strong>
        O endereço acessado não existe no HospCheck.
      </div>
      <EtiquetaDemo />
    </Layout>
  );
}
