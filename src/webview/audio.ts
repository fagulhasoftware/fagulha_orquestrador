import type { PacoteAudioVoz } from '../shared/protocolo';
import { enviar, h } from './util';
let atual: { id: string; parar: () => void } | undefined, pendente: PacoteAudioVoz | undefined;
let botao: HTMLButtonElement | undefined;
let avisou = false;
function permitir(p: PacoteAudioVoz): void {
  pendente = p;
  botao ??= h(
    'button',
    {
      class: 'btn primario ativar-audio',
      type: 'button',
      onclick: () => {
        const a = pendente;
        pendente = undefined;
        botao?.remove();
        if (a) reproduzirVoz(a);
      },
    },
    'Ativar audio',
  );
  document.body.append(botao);
}
export function pararAudio(id?: string): void {
  if (pendente && (!id || pendente.id === id)) {
    pendente = undefined;
    botao?.remove();
  }
  if (atual && (!id || atual.id === id)) {
    const p = atual;
    atual = undefined;
    p.parar();
  }
}
export function vozesSistema(): void {
  const sintetizador = window.speechSynthesis;
  enviar({
    tipo: 'vozesSistema',
    disponivel: !!sintetizador,
    vozes:
      sintetizador
        ?.getVoices()
        .slice(0, 200)
        .map((v) => ({ id: v.voiceURI.slice(0, 200), nome: v.name.slice(0, 200) })) ?? [],
  });
}
export function reproduzirVoz(p: PacoteAudioVoz): void {
  pararAudio();
  let encerrado = false;
  const fim = (estado: 'concluido' | 'erro' | 'cancelado') => {
    if (encerrado) return;
    encerrado = true;
    if (atual?.id === p.id) atual = undefined;
    enviar({ tipo: 'vozAudioEstado', id: p.id, estado });
  };
  if (p.base64 && p.mime) {
    let url: string;
    try {
      const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: p.mime }));
    } catch {
      fim('erro');
      return;
    }
    const audio = new Audio(url);
    audio.playbackRate = p.velocidade;
    const limpar = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
    };
    atual = {
      id: p.id,
      parar: () => {
        limpar();
        fim('cancelado');
      },
    };
    audio.onended = () => {
      if (encerrado) return;
      limpar();
      fim('concluido');
    };
    audio.onerror = () => {
      if (encerrado) return;
      limpar();
      fallbackSistema(p, fim);
    };
    audio.play().catch((e) => {
      limpar();
      if (encerrado) return;
      if (e?.name === 'NotAllowedError') {
        atual = undefined;
        permitir(p);
      } else fallbackSistema(p, fim);
    });
    return;
  }
  falarSistema(p, fim);
}
function fallbackSistema(
  p: PacoteAudioVoz,
  fim: (estado: 'concluido' | 'erro' | 'cancelado') => void,
): void {
  if (!avisou) {
    avisou = true;
    enviar({
      tipo: 'vozAudioFalha',
      motivo: 'Audio neural nao foi aceito pelo webview. Usando a voz do sistema.',
    });
  }
  falarSistema({ ...p, voz: undefined }, fim);
}
function falarSistema(
  p: PacoteAudioVoz,
  fim: (estado: 'concluido' | 'erro' | 'cancelado') => void,
): void {
  if (!window.speechSynthesis) {
    fim('erro');
    return;
  }
  const u = new SpeechSynthesisUtterance(p.texto);
  u.lang = 'pt-BR';
  u.rate = p.velocidade;
  const voces = speechSynthesis.getVoices();
  u.voice =
    voces.find((v) => v.voiceURI === p.voz) ??
    voces.find((v) => v.lang.toLowerCase() === 'pt-br') ??
    null;
  u.onend = () => fim('concluido');
  u.onerror = (e) => {
    if (e.error === 'not-allowed') {
      atual = undefined;
      permitir({ ...p, base64: undefined, mime: undefined });
    } else fim(e.error === 'canceled' || e.error === 'interrupted' ? 'cancelado' : 'erro');
  };
  atual = {
    id: p.id,
    parar: () => {
      speechSynthesis.cancel();
      fim('cancelado');
    },
  };
  speechSynthesis.speak(u);
}
window.addEventListener('pagehide', () => pararAudio());
if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', vozesSistema);
