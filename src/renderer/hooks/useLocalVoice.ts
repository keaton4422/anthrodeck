import { useCallback, useRef, useState } from 'react';
import { pcmToWav } from '../lib/audio';

// Push-to-talk capture for the local whisper backend. Records raw mic PCM via Web Audio while L2 is
// held, then on release encodes a 16 kHz mono WAV and hands it to the main process for
// transcription. Distinct from useVoice (Web Speech) so the two backends can coexist. `onError`
// says why nothing was heard (no mic, or the engine failed), so the pilot isn't left guessing.
export function useLocalVoice(onResult: (text: string) => void, onError?: (msg: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const rateRef = useRef<number>(48000);

  const startListening = useCallback(async () => {
    if (isListening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      rateRef.current = ctx.sampleRate;
      chunksRef.current = [];

      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;
      proc.onaudioprocess = (e) => {
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(proc);
      proc.connect(ctx.destination);
      setIsListening(true);
    } catch (e) {
      setIsListening(false);
      onErrorRef.current?.(`Couldn't use the microphone (${(e as Error).name || 'error'}).`);
    }
  }, [isListening]);

  const teardown = useCallback(() => {
    procRef.current?.disconnect();
    procRef.current = null;
    ctxRef.current?.close().catch(() => { /* ignore */ });
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopListening = useCallback(async () => {
    if (!isListening) return;
    setIsListening(false);

    const chunks = chunksRef.current;
    chunksRef.current = [];
    const rate = rateRef.current;
    teardown();

    const total = chunks.reduce((n, c) => n + c.length, 0);
    if (total === 0) return;
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }

    setTranscribing(true);
    try {
      const wav = pcmToWav(merged, rate);
      const text = await window.electronAPI.voiceTranscribe(wav);
      if (text && text.trim()) onResultRef.current(text.trim());
      else if (text === null) onErrorRef.current?.('Couldn\'t make out any words. Try again.');
      else onErrorRef.current?.('Didn\'t hear anything. Hold L2 while you talk.');
    } catch {
      onErrorRef.current?.('Couldn\'t make out any words. Try again.');
    } finally {
      setTranscribing(false);
    }
  }, [isListening, teardown]);

  return { isListening, transcribing, startListening, stopListening };
}
