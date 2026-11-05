/**
 * WinVibe 8-bit 复古合成器音效管理器
 * 基于原生 Web Audio API，无需引入外部音频资源，纯代码合成经典 8-bit 音效
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('winvibe_muted') === 'true';
    } catch {}
  }

  private getContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem('winvibe_muted', String(this.muted));
    } catch {}
    return this.muted;
  }

  /**
   * 8-bit 任务就绪/完成提示音：上升三和弦琶音 (C5 -> E5 -> G5 -> C6)
   */
  public playSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const startTime = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.08);

      gain.gain.setValueAtTime(0.12, startTime + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.08 + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.08);
      osc.stop(startTime + idx * 0.08 + 0.12);
    });
  }

  /**
   * 8-bit 提问/高危审批提示音：双频跳跃 (F5 -> A5)
   */
  public playAttention() {
    const ctx = this.getContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    const freqs = [698.46, 880.00];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.09);

      gain.gain.setValueAtTime(0.08, startTime + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.09 + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.09);
      osc.stop(startTime + idx * 0.09 + 0.14);
    });
  }

  /**
   * 8-bit 拦截/拒绝警告音：下行沉闷低音 (Eb4 -> C4)
   */
  public playDeny() {
    const ctx = this.getContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(311.13, startTime);
    osc.frequency.exponentialRampToValueAtTime(261.63, startTime + 0.18);

    gain.gain.setValueAtTime(0.10, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.18);
  }
}

export const soundManager = new SoundManager();
