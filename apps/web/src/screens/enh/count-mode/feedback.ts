export enum ScanTone {
  Counted = "counted",
  Rejected = "rejected",
  Failed = "failed",
}

const MUTE_STORAGE_KEY = "mezan.count-mode.muted";

interface ToneStep {
  readonly frequency: number;
  readonly startMs: number;
  readonly durationMs: number;
}

const TONES: Readonly<Record<ScanTone, readonly ToneStep[]>> = {
  [ScanTone.Counted]: [{ frequency: 1760, startMs: 0, durationMs: 90 }],
  [ScanTone.Rejected]: [
    { frequency: 330, startMs: 0, durationMs: 140 },
    { frequency: 220, startMs: 170, durationMs: 220 },
  ],
  [ScanTone.Failed]: [
    { frequency: 440, startMs: 0, durationMs: 120 },
    { frequency: 440, startMs: 180, durationMs: 120 },
    { frequency: 440, startMs: 360, durationMs: 120 },
  ],
};

const VOLUME = 0.12;
const MS_PER_SECOND = 1000;

export function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    return;
  }
}

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  const Constructor = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Constructor) return null;
  try {
    context = new Constructor();
  } catch {
    context = null;
  }
  return context;
}

export function playTone(tone: ScanTone): void {
  const audio = audioContext();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => undefined);
  const base = audio.currentTime;
  for (const step of TONES[tone]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = base + step.startMs / MS_PER_SECOND;
    const end = start + step.durationMs / MS_PER_SECOND;
    oscillator.type = "square";
    oscillator.frequency.value = step.frequency;
    gain.gain.setValueAtTime(VOLUME, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
