// HospCheck — contexto de sessão e permissões (espelha as regras do servidor)
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ErroApi, type Perfil, type Permissoes, type SessaoAtual, type UsuarioSessao } from './api';

interface ContextoSessao {
  usuario: UsuarioSessao | null;
  permissoes: Permissoes;
  integracoes: any;
  carregando: boolean;
  erro: string | null;
  pode: (acao: string) => boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  atualizar: () => Promise<void>;
}

const Ctx = createContext<ContextoSessao>(null as unknown as ContextoSessao);
export const usarSessao = () => useContext(Ctx);

export function ProvedorSessao({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [permissoes, setPermissoes] = useState<Permissoes>({});
  const [integracoes, setIntegracoes] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const atualizar = useCallback(async () => {
    try {
      const r = await api.get<SessaoAtual>('/api/auth/eu');
      setUsuario(r.usuario);
      setPermissoes(r.permissoes || {});
      setIntegracoes(r.integracoes || null);
      setErro(null);
    } catch (e) {
      setUsuario(null);
      setPermissoes({});
      if (e instanceof ErroApi && e.status !== 401) setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void atualizar(); }, [atualizar]);

  const entrar = useCallback(async (email: string, senha: string) => {
    await api.post('/api/auth/entrar', { email, senha });
    await atualizar();
  }, [atualizar]);

  const sair = useCallback(async () => {
    try { await api.post('/api/auth/sair'); } catch { /* sessão já encerrada */ }
    setUsuario(null);
    setPermissoes({});
    window.location.assign('/entrar');
  }, []);

  const pode = useCallback((acao: string) => !!permissoes[acao], [permissoes]);

  const valor = useMemo<ContextoSessao>(() =>
    ({ usuario, permissoes, integracoes, carregando, erro, pode, entrar, sair, atualizar }),
    [usuario, permissoes, integracoes, carregando, erro, pode, entrar, sair, atualizar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
