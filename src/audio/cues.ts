import { useEffect, useRef, useState } from "react";

type SpeechResult = {
  isFinal: boolean;
  0?: { transcript: string };
};

type SpeechEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
};

type SpeechErrorEvent = { error: string };

type SpeechRecognizer = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechCtor = new () => SpeechRecognizer;

function recognitionCtor(): SpeechCtor | null {
  const host = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

/** Spoken cue. Later calls replace anything still being said. */
export function speak(text: string): void {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.lang = "en-US";
  synth.speak(utterance);
}

export function isReadyPhrase(transcript: string): boolean {
  return /\bready\b/i.test(transcript);
}

export type MicStatus = "unknown" | "granted" | "needs-mic" | "unavailable";

/** Listens for the word "ready" only while `enabled` is true. One phrase starts the trial once. */
export function useReadyVoice(enabled: boolean, onReady: () => void): MicStatus {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [status, setStatus] = useState<MicStatus>("unknown");

  useEffect(() => {
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    let active = true;
    permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (!active) return;
        setStatus(result.state === "granted" ? "granted" : "needs-mic");
        result.onchange = () => setStatus(result.state === "granted" ? "granted" : "needs-mic");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus("unavailable");
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    let stopped = false;
    let fired = false;
    let denied = false;
    recognition.onresult = (event) => {
      if (fired) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        if (!isReadyPhrase(result[0]?.transcript ?? "")) continue;
        fired = true;
        setStatus("granted");
        onReadyRef.current();
        try {
          recognition.stop();
        } catch {
          // Stopping a finished recognizer is not an error the user needs to see.
        }
        return;
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        denied = true;
        setStatus("needs-mic");
      }
    };
    recognition.onend = () => {
      if (stopped || fired || denied) return;
      try {
        recognition.start();
      } catch {
        // The browser can already be restarting the same recognizer.
      }
    };
    try {
      recognition.start();
    } catch {
      setStatus("needs-mic");
    }
    return () => {
      stopped = true;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    };
  }, [enabled]);

  return status;
}
