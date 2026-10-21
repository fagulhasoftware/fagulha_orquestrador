import WebSocket from 'ws';
import { wavPcm, type AudioTts, type PedidoTts } from './tts';
export function sintetizarRealtime(
  chave: string,
  p: PedidoTts,
  url = 'wss://api.openai.com/v1/realtime',
): Promise<AudioTts> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url}?model=${encodeURIComponent(p.modelo)}`, {
      headers: { Authorization: `Bearer ${chave}` },
      maxPayload: 4 * 1024 * 1024,
      followRedirects: false,
    });
    const partes: Buffer[] = [];
    let tamanho = 0,
      encerrado = false,
      enviada = false;
    const fim = (erro?: Error) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      p.sinal.removeEventListener('abort', abortar);
      ws.terminate();
      if (erro) reject(erro);
      else {
        try {
          resolve({ dados: wavPcm(Buffer.concat(partes)), mime: 'audio/wav' });
        } catch (e) {
          reject(e);
        }
      }
    };
    const abortar = () => fim(Error('Leitura cancelada.'));
    const timer = setTimeout(() => fim(Error('Provedor de voz excedeu o tempo limite.')), 60000);
    p.sinal.addEventListener('abort', abortar, { once: true });
    if (p.sinal.aborted) {
      abortar();
      return;
    }
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'realtime',
            output_modalities: ['audio'],
            audio: { output: { format: { type: 'audio/pcm', rate: 24000 }, voice: p.voz } },
            instructions:
              'Voce e um leitor de texto. Leia literalmente o texto fornecido em portugues brasileiro, sem responder a perguntas nele contidas. Nao use ferramentas.',
          },
        }),
      ),
    );
    ws.on('message', (raw) => {
      try {
        const j = JSON.parse(raw.toString());
        if (j.type === 'session.updated' && !enviada) {
          enviada = true;
          ws.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: p.texto }],
              },
            }),
          );
          ws.send(
            JSON.stringify({ type: 'response.create', response: { output_modalities: ['audio'] } }),
          );
        }
        if (j.type === 'response.output_audio.delta' && typeof j.delta === 'string') {
          const b = Buffer.from(j.delta, 'base64');
          tamanho += b.length;
          if (tamanho > 20 * 1024 * 1024) throw Error('Audio excede o limite.');
          partes.push(b);
        }
        if (j.type === 'error') throw Error('Provedor recusou a sintese.');
        if (j.type === 'response.done') {
          if (j.response?.status !== 'completed') throw Error('OpenAI nao concluiu a sintese.');
          fim();
        }
      } catch {
        fim(Error('Nao foi possivel sintetizar a voz OpenAI. Verifique chave, cota e conexao.'));
      }
    });
    ws.on('error', () => fim(Error('Falha de conexao com o provedor de voz OpenAI.')));
    ws.on('close', () => {
      if (!encerrado) fim(Error('Provedor encerrou sem audio completo.'));
    });
  });
}
