// HospCheck — tela de login com preservação de destino (QR ou rota direta)
import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { usarSessao } from '../sessao';
import { Aviso, Marca, Icone } from '../componentes';
import { ErroApi } from '../api';

function lerDestino(): string {
  const params = new URLSearchParams(window.location.search);
  const d = params.get('destino');
  if (!d) return '/';
  // Só aceita caminhos internos (evita open redirect)
  return d.startsWith('/') && !d.startsWith('//') ? d : '/';
}

export function TelaLogin() {
  const { entrar, usuario, carregando } = usarSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const [usuarioInput, setUsuarioInput] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocultarSenha, setOcultarSenha] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const destino = lerDestino();

  if (!carregando && usuario) return <Navigate to={destino === '/entrar' ? '/' : destino} replace />;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!usuarioInput.trim() || !senha) { setErro('Informe usuário e senha.'); return; }
    setEnviando(true);
    try {
      await entrar(usuarioInput.trim(), senha);
      navegar(destino === '/entrar' ? '/' : destino, { replace: true });
    } catch (ex) {
      setErro(ex instanceof ErroApi ? ex.message : 'Falha ao entrar.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="tela-login">
      <div className="cartao-login">
        <div className="cartao-login__marca">
          <Marca tam={40} />
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#083F77' }}>HospCheck</span>
        </div>
        <p className="cartao-login__sub">Gestão de equipamentos hospitalares</p>
        <h1 className="cartao-login__titulo">Entrar</h1>

        {local.state?.motivo && <Aviso tipo="info">{String((local.state as any).motivo)}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <form onSubmit={enviar} noValidate>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="email">Usuário ou e-mail</label>
            <input id="email" className="entrada" type="text" autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="seu.usuario"
              value={usuarioInput} onChange={e => setUsuarioInput(e.target.value)}
              aria-invalid={!!erro && !usuarioInput.trim()} required />
          </div>

          <div className="campo">
            <label className="campo__rotulo" htmlFor="senha">Senha</label>
            <div style={{ position: 'relative' }}>
              <input id="senha" className="entrada" type={ocultarSenha ? 'password' : 'text'}
                autoComplete="current-password" placeholder="••••••••"
                value={senha} onChange={e => setSenha(e.target.value)} required
                style={{ paddingRight: 46 }} />
              <button type="button" onClick={() => setOcultarSenha(v => !v)}
                aria-label={ocultarSenha ? 'Mostrar senha' : 'Ocultar senha'}
                style={{ position: 'absolute', right: 4, top: 2, width: 44, height: 44, border: 0,
                  background: 'transparent', color: '#5B697D', cursor: 'pointer' }}>
                <Icone nome="cadeado" tam={19} />
              </button>
            </div>
          </div>

          <button type="submit" className="botao botao--verde botao--largura-total botao--grande" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="texto-pequeno" style={{ marginTop: 14, marginBottom: 0 }}>
          Esqueceu a senha? Peça ao administrador do hospital para redefini-la.
          No primeiro acesso, o sistema pede a troca da senha provisória.
        </p>
      </div>

      <p style={{ color: 'rgba(255,255,255,.75)', fontSize: '.74rem', marginTop: 16, textAlign: 'center', maxWidth: 420 }}>
        Ao ler o QR Code de um equipamento, o HospCheck preserva o destino e traz você de volta aqui se precisar entrar.
      </p>
    </div>
  );
}
