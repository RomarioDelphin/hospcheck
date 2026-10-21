// HospCheck — troca de senha do próprio usuário (obrigatória no primeiro acesso)
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ErroApi } from '../api';
import { usarSessao } from '../sessao';
import { Aviso, Icone, Layout } from '../componentes';

export function TelaTrocarSenha() {
  const { usuario, atualizar } = usarSessao();
  const navegar = useNavigate();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const obrigatoria = !!usuario?.deve_trocar_senha;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!senhaAtual) return setErro('Informe a senha atual.');
    if (nova.length < 8) return setErro('A nova senha deve ter no mínimo 8 caracteres.');
    if (nova !== confirma) return setErro('A confirmação não confere com a nova senha.');
    if (nova === senhaAtual) return setErro('A nova senha deve ser diferente da atual.');
    setEnviando(true);
    try {
      await api.post('/api/auth/senha', { senha_atual: senhaAtual, nova_senha: nova });
      await atualizar();
      setSucesso(true);
      setSenhaAtual(''); setNova(''); setConfirma('');
      setTimeout(() => navegar('/', { replace: true }), 1200);
    } catch (ex) {
      setErro(ex instanceof ErroApi ? ex.message : 'Falha ao trocar a senha.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Layout titulo="Trocar senha">
      {!obrigatoria && (
        <Link to="/mais" className="botao botao--fantasma botao--pequeno" style={{ marginBottom: 12 }}>
          <Icone nome="voltar" tam={17} /> Voltar
        </Link>
      )}

      {obrigatoria && (
        <Aviso tipo="atencao" titulo="Primeiro acesso — troca de senha obrigatória">
          Sua senha provisória precisa ser substituída antes de usar o sistema.
          Escolha uma nova senha com no mínimo 8 caracteres.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso" titulo="Senha alterada">Nova senha salva. Abrindo o painel…</Aviso>}

      <div className="cartao">
        <div className="cartao__titulo">
          <span><Icone nome="cadeado" tam={18} /> Usuário: {usuario?.email}</span>
        </div>
        <form onSubmit={enviar} noValidate>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="senha-atual">Senha atual <span className="texto-vermelho">*</span></label>
            <input id="senha-atual" className="entrada" type="password" autoComplete="current-password"
              value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} required />
          </div>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="senha-nova">Nova senha (mín. 8) <span className="texto-vermelho">*</span></label>
            <input id="senha-nova" className="entrada" type="password" autoComplete="new-password"
              minLength={8} value={nova} onChange={e => setNova(e.target.value)} required />
          </div>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="senha-confirma">Confirmar nova senha <span className="texto-vermelho">*</span></label>
            <input id="senha-confirma" className="entrada" type="password" autoComplete="new-password"
              minLength={8} value={confirma} onChange={e => setConfirma(e.target.value)} required />
          </div>
          <button type="submit" className="botao botao--verde botao--largura-total" disabled={enviando || sucesso}>
            {enviando ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </form>
        <p className="texto-pequeno" style={{ marginTop: 10, marginBottom: 0 }}>
          Ao trocar a senha, as outras sessões abertas deste usuário são encerradas.
        </p>
      </div>
    </Layout>
  );
}
