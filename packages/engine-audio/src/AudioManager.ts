import { MUSIC_TRACK_FILES, type MusicTrackId } from "./tracks.js";

export interface AudioState {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  musicVolume: number;
  sfxVolume: number;
  currentTrack: MusicTrackId | null;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private readonly sfxBuffers = new Map<string, AudioBuffer>();
  private readonly sfxLoading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly sfxLastPlayed = new Map<string, number>();
  private readonly sfxActiveVoices = new Map<string, number>();

  private currentAudioEl: HTMLAudioElement | null = null;
  private currentTrack: MusicTrackId | null = null;
  private musicEnabled = true;
  private sfxEnabled = true;
  private musicVolume = 0.45;
  private sfxVolume = 0.7;
  private readonly baseUrl: string;
  private readonly maxConcurrentPerSfx = 4;
  private readonly minRepeatIntervalMs = 45;

  constructor(baseUrl = "/assets/audio") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxEnabled ? this.sfxVolume : 0;
        this.sfxGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    if (this.currentAudioEl && this.musicEnabled && this.currentAudioEl.paused) {
      void this.currentAudioEl.play().catch(() => undefined);
    }
  }

  getState(): AudioState {
    return {
      musicEnabled: this.musicEnabled,
      sfxEnabled: this.sfxEnabled,
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume,
      currentTrack: this.currentTrack
    };
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (this.currentAudioEl) {
      if (enabled) {
        this.currentAudioEl.volume = this.musicVolume;
        void this.currentAudioEl.play().catch(() => undefined);
      } else {
        this.currentAudioEl.pause();
      }
    }
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(enabled ? this.sfxVolume : 0, this.ctx.currentTime);
    }
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.currentAudioEl && this.musicEnabled) {
      this.currentAudioEl.volume = this.musicVolume;
    }
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    if (this.sfxGain && this.ctx && this.sfxEnabled) {
      this.sfxGain.gain.setValueAtTime(this.sfxVolume, this.ctx.currentTime);
    }
  }

  playMusic(trackId: MusicTrackId, fadeMs = 800): void {
    if (typeof window === "undefined") return;
    if (this.currentTrack === trackId && this.currentAudioEl) {
      if (this.musicEnabled && this.currentAudioEl.paused) {
        void this.currentAudioEl.play().catch(() => undefined);
      }
      return;
    }

    const previous = this.currentAudioEl;
    this.currentTrack = trackId;

    const filename = MUSIC_TRACK_FILES[trackId];
    const url = `${this.baseUrl}/music/${encodeURIComponent(filename)}`;
    const next = new Audio(url);
    next.loop = true;
    next.volume = 0;
    this.currentAudioEl = next;

    if (previous) {
      this.fadeVolume(previous, previous.volume, 0, fadeMs, () => {
        previous.pause();
        previous.src = "";
      });
    }

    if (this.musicEnabled) {
      void next
        .play()
        .then(() => {
          this.fadeVolume(next, 0, this.musicVolume, fadeMs);
        })
        .catch(() => {
          // Will start upon unlock() after first user gesture
          next.volume = this.musicVolume;
        });
    }
  }

  async playSfx(name: string, volumeScale = 1): Promise<void> {
    if (!this.sfxEnabled || typeof window === "undefined") return;
    this.unlock();
    if (!this.ctx || !this.sfxGain) return;

    const now = performance.now();
    const last = this.sfxLastPlayed.get(name) ?? 0;
    if (now - last < this.minRepeatIntervalMs) return;

    const active = this.sfxActiveVoices.get(name) ?? 0;
    if (active >= this.maxConcurrentPerSfx) return;

    const buffer = await this.loadSfxBuffer(name);
    if (!buffer || !this.ctx || !this.sfxGain) return;

    this.sfxLastPlayed.set(name, now);
    this.sfxActiveVoices.set(name, active + 1);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(2, volumeScale));
    src.connect(gain);
    gain.connect(this.sfxGain);
    src.onended = () => {
      const cur = this.sfxActiveVoices.get(name) ?? 1;
      this.sfxActiveVoices.set(name, Math.max(0, cur - 1));
    };
    src.start();
  }

  private async loadSfxBuffer(name: string): Promise<AudioBuffer | null> {
    const cached = this.sfxBuffers.get(name);
    if (cached) return cached;
    const inflight = this.sfxLoading.get(name);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        if (!this.ctx) return null;
        const res = await fetch(`${this.baseUrl}/sfx/${encodeURIComponent(name)}.mp3`);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arr);
        this.sfxBuffers.set(name, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.sfxLoading.delete(name);
      }
    })();

    this.sfxLoading.set(name, promise);
    return promise;
  }

  private fadeVolume(
    el: HTMLAudioElement,
    from: number,
    to: number,
    durationMs: number,
    onDone?: () => void
  ): void {
    const start = performance.now();
    const step = (ts: number) => {
      const p = durationMs <= 0 ? 1 : Math.min(1, (ts - start) / durationMs);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * p));
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        onDone?.();
      }
    };
    requestAnimationFrame(step);
  }

  destroy(): void {
    if (this.currentAudioEl) {
      this.currentAudioEl.pause();
      this.currentAudioEl.src = "";
      this.currentAudioEl = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
