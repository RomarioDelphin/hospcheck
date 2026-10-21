// HospCheck — leitura de QR Code: BarcodeDetector quando disponível, jsQR pela câmera
// e digitação manual como alternativa sempre disponível.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ErroApi } from '../api';
import { Aviso, Icone, Layout } from '../componentes';

type Modo = 'camera' | 'manual';

export function TelaEscanear() {
  const navegar = useNavigate();
  const [modo, setModo] = useState<Modo>('manual');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'ocioso' | 'aberta' | 'sem-suporte' | 'negada' | 'procurando'>('ocioso');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const jsQRRef = useRef<any>(null);
  const processandoRef = useRef(false);

  const pararCamera = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    processandoRef.current = false;
  }, []);

  useEffect(() => () => pararCamera(), [pararCamera]);

  const irPara = useCallback(async (valor: string) => {
    const alvo = valor.trim();
    if (!alvo) return;
    setOcupado(true); setErro(null);
    try {
      // Extrai o identificador de qualquer formato de URL estável do HospCheck
      const m = alvo.match(/\/e\/([A-Za-z0-9-]+)($|\?)/);
      const id = m ? m[1] : alvo;
      const r = await api.get<{ destino: string }>(`/api/publico/equipamento/${encodeURIComponent(id)}`);
      navegar(r.destino);
    } catch (e) {
      setErro(e instanceof ErroApi
        ? (e.status === 404 ? 'QR não corresponde a nenhum equipamento cadastrado.' : e.message)
        : 'Não foi possível reconhecer o código.');
      setOcupado(false);
    }
  }, [navegar]);

  const abrirCamera = async () => {
    setErro(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('sem-suporte');
      setErro('Este navegador não permite acesso à câmera. Use a digitação manual abaixo.');
      return;
    }
    setCameraStatus('procurando');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false
      });
      streamRef.current = stream;
      setCameraStatus('aberta'); setModo('camera');
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      // BarcodeDetector nativo quando existe (Chromium/Android)
      const SuporteDetector = (window as any).BarcodeDetector;
      if (SuporteDetector) {
        try {
          const detector = new SuporteDetector({ formats: ['qr_code'] });
          const detectar = async () => {
            if (!streamRef.current || processandoRef.current) return;
            try {
              const codigos = await detector.detect(video);
              if (codigos?.length) {
                processandoRef.current = true;
                pararCamera();
                await irPara(codigos[0].rawValue);
                return;
              }
            } catch { /* segue tentando */ }
            rafRef.current = requestAnimationFrame(detectar);
          };
          rafRef.current = requestAnimationFrame(detectar);
          return;
        } catch { /* cai para o jsQR abaixo */ }
      }

      // Fallback: jsQR a partir dos pixels do vídeo
      try {
        const modulo = await import('jsqr');
        jsQRRef.current = modulo.default || modulo;
      } catch {
        setCameraStatus('sem-suporte');
        setErro('Leitura automática indisponível neste navegador. Use a digitação manual abaixo.');
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const varrer = () => {
        if (!streamRef.current || processandoRef.current) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const achar = jsQRRef.current?.(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (achar?.data) { processandoRef.current = true; pararCamera(); void irPara(achar.data); return; }
        }
        rafRef.current = requestAnimationFrame(varrer);
      };
      rafRef.current = requestAnimationFrame(varrer);
    } catch (e: any) {
      setCameraStatus(e?.name === 'NotAllowedError' ? 'negada' : 'sem-suporte');
      setErro(e?.name === 'NotAllowedError'
        ? 'Acesso à câmera negado. Autorize nas permissões do navegador ou use a digitação manual.'
        : 'Não foi possível abrir a câmera. Use a digitação manual abaixo.');
    }
  };

  return (
    <Layout titulo="Escanear QR">
      <Aviso tipo="info">
        Aponte a câmera para o QR Code da etiqueta do equipamento. O código contém apenas o
        identificador — os dados são carregados com autenticação.
      </Aviso>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="cartao">
        <div className="cartao__titulo">Câmera</div>
        <div className="leitor-qr">
          {modo === 'camera' && cameraStatus === 'aberta'
            ? <video ref={videoRef} playsInline muted />
            : <span style={{ color: 'rgba(255,255,255,.6)', textAlign: 'center', padding: 20, fontSize: '.85rem' }}>
                {cameraStatus === 'procurando' ? 'Solicitando acesso à câmera…' : 'Câmera desligada'}
              </span>}
          {modo === 'camera' && cameraStatus === 'aberta' && <div className="leitor-qr__moldura" />}
        </div>
        <div className="acoes-linha">
          {cameraStatus !== 'aberta'
            ? <button className="botao botao--verde" onClick={() => void abrirCamera()} disabled={ocupado}>
                <Icone nome="camera" tam={19} /> Abrir câmera
              </button>
            : <button className="botao botao--fantasma" onClick={() => { pararCamera(); setCameraStatus('ocioso'); setModo('manual'); }}>
                Desligar câmera
              </button>}
        </div>
        {cameraStatus === 'sem-suporte' && (
          <p className="texto-pequeno" style={{ marginTop: 8 }}>
            A leitura automática não é suportada aqui. A digitação do código abaixo funciona em qualquer navegador.
          </p>
        )}
      </div>

      <div className="cartao">
        <div className="cartao__titulo">Digitação manual</div>
        <p className="texto-pequeno">
          Digite o código impresso na etiqueta (ex.: <b>EQ-0001</b>) ou cole a URL completa do QR.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); void irPara(codigo); }}>
          <div className="campo">
            <label className="campo__rotulo" htmlFor="codigo-qr">Código ou URL do equipamento</label>
            <input id="codigo-qr" className="entrada" value={codigo} onChange={e => setCodigo(e.target.value)}
              placeholder="EQ-0001 ou https://…/e/…" inputMode="text" autoCapitalize="none" autoCorrect="off" />
          </div>
          <button type="submit" className="botao botao--verde botao--largura-total" disabled={ocupado || !codigo.trim()}>
            {ocupado ? 'Localizando…' : 'Abrir ficha do equipamento'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
