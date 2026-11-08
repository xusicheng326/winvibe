import React from 'react';
import { Gauge, DollarSign, Cpu, Clock, AlertTriangle, Sparkles } from 'lucide-react';

export interface TelemetryData {
  totalTokens: number;
  totalCostUsd: number;
  activeSessionsCount: number;
  claude5HrPercent: number;
  claude5HrResetCountdownMinutes: number;
  recentCostHistory?: Array<{ timestamp: number; cost: number }>;
}

interface RateLimitRadarProps {
  telemetry: TelemetryData | null;
}

export const RateLimitRadar: React.FC<RateLimitRadarProps> = ({ telemetry }) => {
  const percent = telemetry?.claude5HrPercent || 0;
  const cost = telemetry?.totalCostUsd || 0;
  const tokens = telemetry?.totalTokens || 0;
  const countdown = telemetry?.claude5HrResetCountdownMinutes || 0;

  let gaugeColor = 'bg-cyan-500';
  if (percent > 85) {
    gaugeColor = 'bg-rose-500';
  } else if (percent > 65) {
    gaugeColor = 'bg-amber-400';
  }

  // 估算当前单会话上下文窗口消耗率（按主流 200k 限制计算）
  const contextLimit = 200_000;
  const contextRatio = Math.min(100, Math.round((tokens / contextLimit) * 100));

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-3">
      {/* 顶栏标题 */}
      <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
        <div className="flex items-center gap-1.5">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <span>Google Antigravity 配额与速率雷达</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Antigravity 实时同步</span>
        </div>
      </div>

      {/* 5小时速率进度条 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 flex items-center gap-1">
            {percent > 80 && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
            Google Antigravity 窗口吞吐负载
          </span>
          <span className="font-mono font-bold text-slate-200">
            {percent}% <span className="text-slate-500 font-normal">/ 100%</span>
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full ${gaugeColor} transition-all duration-500 rounded-full`}
            style={{ width: `${Math.min(100, Math.max(3, percent))}%` }}
          />
        </div>
        {countdown > 0 && (
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              预计滚动配额刷新
            </span>
            <span className="font-mono text-cyan-400 font-medium">约 {countdown} 分钟后恢复</span>
          </div>
        )}
      </div>

      {/* 指标卡片网格 */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {/* 累计费用 */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span>Antigravity 预估算力花费</span>
          </div>
          <div className="text-base font-bold text-slate-100 font-mono mt-0.5">
            ${cost.toFixed(4)}
          </div>
        </div>

        {/* 累计 Tokens */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span>Antigravity 吞吐 Tokens</span>
          </div>
          <div className="text-base font-bold text-slate-100 font-mono mt-0.5">
            {tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens}
          </div>
        </div>
      </div>

      {/* 上下文窗口饱和度提示 */}
      {contextRatio > 65 && (
        <div className="flex items-center gap-1.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>上下文窗口已使用约 {contextRatio}%，建议在终端中执行 <code>/compact</code> 优化推理精度。</span>
        </div>
      )}
    </div>
  );
};
