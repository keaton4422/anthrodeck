import { useCallback, useEffect, useRef, useState } from 'react';

export function useVoice(onResult: (transcript: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const finalRef = useRef('');
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    setIsSupported(true);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      finalRef.current += final;
      setTranscript(finalRef.current + interim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      console.warn('SpeechRecognition error:', e.error);
      setIsListening(false);
    };

    recognitionRef.current = rec;
    return () => {
      rec.abort();
    };
  }, []);

  const startListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec || isListening) return;
    finalRef.current = '';
    setTranscript('');
    setIsListening(true);
    try { rec.start(); } catch { /* already running */ }
  }, [isListening]);

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec || !isListening) return;
    setIsListening(false);
    rec.stop();
    // Give browser a tick to fire final onresult before we read
    setTimeout(() => {
      const result = finalRef.current.trim();
      if (result) {
        onResultRef.current(result);
        setTranscript('');
      }
      finalRef.current = '';
    }, 250);
  }, [isListening]);

  return { isListening, transcript, isSupported, startListening, stopListening };
}
