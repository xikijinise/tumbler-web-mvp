import type { SoftnessPreset } from "./flavors";

class JellyAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private lastSoundAt = 0;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private canPlay(minGapMs = 48): boolean {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this.lastSoundAt < minGapMs) return false;
    this.lastSoundAt = now;
    return true;
  }

  playPoke(intensity: number, softness: SoftnessPreset) {
    if (!this.canPlay(45)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.min(1.5, Math.max(0.25, intensity));
    const baseFreq = (175 + Math.random() * 45) * softness.audioPitchScale;
    const duration = 0.28 + clamped * 0.14;

    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq * 1.42, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.78, now + 0.055);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.08, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.96, now + duration);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(9.5 * softness.audioPitchScale, now);
    lfoGain.gain.setValueAtTime(baseFreq * 0.16 * clamped, now);
    lfoGain.gain.exponentialRampToValueAtTime(0.5, now + duration);

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16 * Math.min(1.2, clamped), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + duration + 0.02);
    lfo.stop(now + duration + 0.02);
  }

  playRelease(intensity: number, softness: SoftnessPreset) {
    if (!this.canPlay(55)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.min(1.6, Math.max(0.35, intensity));
    const baseFreq = (150 + Math.random() * 30) * softness.audioPitchScale;
    const duration = 0.42 + clamped * 0.16;

    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    const overtoneGain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq * 0.72, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.75, now + 0.07);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.05, now + duration);

    overtone.type = "triangle";
    overtone.frequency.setValueAtTime(baseFreq * 1.44, now);
    overtone.frequency.exponentialRampToValueAtTime(baseFreq * 2.4, now + 0.08);
    overtone.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + duration);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(12.5 * softness.audioPitchScale, now);
    lfoGain.gain.setValueAtTime(baseFreq * 0.24 * clamped, now);
    lfoGain.gain.exponentialRampToValueAtTime(0.8, now + duration);

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(overtone.frequency);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18 * Math.min(1.2, clamped), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    overtoneGain.gain.setValueAtTime(0.001, now);
    overtoneGain.gain.linearRampToValueAtTime(0.05 * Math.min(1.2, clamped), now + 0.018);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0005, now + duration * 0.7);

    osc.connect(gain);
    overtone.connect(overtoneGain);
    gain.connect(ctx.destination);
    overtoneGain.connect(ctx.destination);

    osc.start(now);
    overtone.start(now);
    lfo.start(now);
    osc.stop(now + duration + 0.02);
    overtone.stop(now + duration + 0.02);
    lfo.stop(now + duration + 0.02);
  }

  playBounce(intensity: number, softness: SoftnessPreset) {
    if (!this.canPlay(75)) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.min(1.3, Math.max(0.2, intensity));
    const baseFreq = 115 * softness.audioPitchScale;
    const duration = 0.24 + clamped * 0.1;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq * 1.35, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.65, now + 0.06);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.95, now + duration);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14 * clamped, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}

export const jellyAudio = new JellyAudioEngine();
