import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { SessionMetrics } from '../adapters/types.js';

export interface GlobalTelemetry {
  totalTokens: number;
  totalCostUsd: number;
  activeSessionsCount: number;
  claude5HrPercent: number; // 兼容字段，展示为 Antigravity 速率/配额使用百分比
  claude5HrResetCountdownMinutes: number;
  recentCostHistory: Array<{ timestamp: number; cost: number }>;
}

export class TelemetryService {
  private metricsBySession = new Map<string, SessionMetrics>();
  private usageHistory: Array<{ timestamp: number; tokens: number; cost: number }> = [];
  private onUpdateCallback?: (telemetry: GlobalTelemetry) => void;

  constructor() {
    this.tryLoadAntigravityStats();
  }

  public setOnUpdate(cb: (telemetry: GlobalTelemetry) => void) {
    this.onUpdateCallback = cb;
  }

  /**
   * 优先以 Google Antigravity 的 brain 目录历史和实时日志为准计算全局用量
   */
  public tryLoadAntigravityStats(): void {
    try {
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      if (!fs.existsSync(brainDir)) return;

      const subdirs = fs.readdirSync(brainDir);
      let grandTotalTokens = 0;
      let grandTotalCost = 0;

      for (const d of subdirs) {
        const logFile = path.join(brainDir, d, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf-8').trim();
          if (!content) continue;
          const lines = content.split('\n');
          let sessionTokens = 0;

          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.input_tokens || obj.output_tokens || obj.cache_read_tokens) {
                const inTok = obj.input_tokens || 0;
                const outTok = obj.output_tokens || 0;
                const cacheTok = obj.cache_read_tokens || 0;
                const total = inTok + outTok + cacheTok;
                sessionTokens += total;
              }
            } catch {}
          }

          if (sessionTokens > 0) {
            grandTotalTokens += sessionTokens;
            // Gemini Flash / Pro 综合加权费率估算
            const cost = (sessionTokens / 1_000_000) * 1.5;
            grandTotalCost += cost;
            this.metricsBySession.set(`agy-${d.slice(0, 8)}`, {
              totalTokens: sessionTokens,
              costUsd: Number(cost.toFixed(4)),
            });
            this.usageHistory.push({
              timestamp: fs.statSync(logFile).mtimeMs,
              tokens: sessionTokens,
              cost,
            });
          }
        }
      }

      this.emit();
    } catch (err) {
      console.warn('[TelemetryService] 读取 Google Antigravity 历史用量异常:', err);
    }
  }

  public recordSessionTokens(sessionId: string, inputTokens: number, outputTokens: number, model: string = 'claude-3-7-sonnet') {
    let inputRate = 3.0 / 1_000_000;
    let outputRate = 15.0 / 1_000_000;

    if (model.includes('opus')) {
      inputRate = 15.0 / 1_000_000;
      outputRate = 75.0 / 1_000_000;
    } else if (model.includes('haiku') || model.includes('flash')) {
      inputRate = 0.8 / 1_000_000;
      outputRate = 4.0 / 1_000_000;
    }

    const cost = inputTokens * inputRate + outputTokens * outputRate;
    const totalTokens = inputTokens + outputTokens;

    const current = this.metricsBySession.get(sessionId) || {};
    const updated: SessionMetrics = {
      inputTokens: (current.inputTokens || 0) + inputTokens,
      outputTokens: (current.outputTokens || 0) + outputTokens,
      totalTokens: (current.totalTokens || 0) + totalTokens,
      costUsd: Number(((current.costUsd || 0) + cost).toFixed(4)),
      stepCount: (current.stepCount || 0) + 1,
      contextUsagePercent: Math.min(100, Math.round((totalTokens / 200_000) * 100)),
    };

    this.metricsBySession.set(sessionId, updated);
    this.usageHistory.push({ timestamp: Date.now(), tokens: totalTokens, cost });
    this.pruneHistory();
    this.emit();
  }

  public getSessionMetrics(sessionId: string): SessionMetrics | undefined {
    return this.metricsBySession.get(sessionId);
  }

  public getGlobalTelemetry(activeCount: number = 0): GlobalTelemetry {
    let totalTokens = 0;
    let totalCostUsd = 0;

    for (const m of this.metricsBySession.values()) {
      totalTokens += m.totalTokens || 0;
      totalCostUsd += m.costUsd || 0;
    }

    // 5小时滚动限制估算 (以 500,000 tokens 为默认基准窗口，支持自适应调整)
    const fiveHoursAgo = Date.now() - 5 * 3600 * 1000;
    const fiveHrUsage = this.usageHistory
      .filter(item => item.timestamp >= fiveHoursAgo)
      .reduce((acc, cur) => acc + cur.tokens, 0);

    const CLAUDE_5HR_BUDGET = 500_000;
    const claude5HrPercent = Math.min(100, Math.round((fiveHrUsage / CLAUDE_5HR_BUDGET) * 100));

    // 计算重置倒计时：最近记录距离 5 小时满期的分钟数
    let claude5HrResetCountdownMinutes = 0;
    if (this.usageHistory.length > 0) {
      const oldestInWindow = this.usageHistory.find(item => item.timestamp >= fiveHoursAgo);
      if (oldestInWindow) {
        const remainingMs = Math.max(0, oldestInWindow.timestamp + 5 * 3600 * 1000 - Date.now());
        claude5HrResetCountdownMinutes = Math.ceil(remainingMs / (60 * 1000));
      }
    }

    return {
      totalTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      activeSessionsCount: activeCount,
      claude5HrPercent,
      claude5HrResetCountdownMinutes,
      recentCostHistory: this.usageHistory.slice(-10),
    };
  }

  private tryLoadClaudeStats(): void {
    try {
      const claudeStatsPath = path.join(os.homedir(), '.claude', 'stats.json');
      if (fs.existsSync(claudeStatsPath)) {
        const data = JSON.parse(fs.readFileSync(claudeStatsPath, 'utf-8'));
        if (data.totalTokens) {
          this.usageHistory.push({
            timestamp: Date.now(),
            tokens: data.totalTokens,
            cost: (data.totalTokens / 1_000_000) * 5.0,
          });
        }
      }
    } catch {}
  }

  private pruneHistory(): void {
    const oneDayAgo = Date.now() - 24 * 3600 * 1000;
    this.usageHistory = this.usageHistory.filter(item => item.timestamp >= oneDayAgo);
  }

  private emit(): void {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.getGlobalTelemetry());
    }
  }
}
