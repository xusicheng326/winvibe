import React from 'react';
import { Layers, Activity, FileText, History, ExternalLink, StopCircle } from 'lucide-react';
import type { AuditRecord, ActivePlan } from '../../vite-env';
import { AuditHistoryTab } from '../audit/AuditHistoryTab';
import { RateLimitRadar, type TelemetryData } from '../telemetry/RateLimitRadar';

export interface AgentSession {
  id: string;
  name: string;
  status: 'running' | 'waiting' | 'completed' | 'error';
  lastMessage: string;
  startTime: number;
  pid?: number;
  sessionId?: string;
  cwd?: string;
  source?: 'hook' | 'log' | 'process' | 'oasp';
}

interface CommandDeckProps {
  agents: AgentSession[];
  activePlan: ActivePlan | null;
  auditList: AuditRecord[];
  telemetry: TelemetryData | null;
  activeTab: 'agents' | 'plan' | 'telemetry' | 'audit';
  setActiveTab: (tab: 'agents' | 'plan' | 'telemetry' | 'audit') => void;
  onFocus: (pid?: number, nameHint?: string, cwdHint?: string) => void;
  onAbort: (sessionId: string, pid?: number) => void;
  onClearAudit: () => void;
}

export const CommandDeck: React.FC<CommandDeckProps> = ({
  agents,
  activePlan,
  auditList,
  telemetry,
  activeTab,
  setActiveTab,
  onFocus,
  onAbort,
  onClearAudit,
}) => {
  return (
    <div className="w-full bg-slate-900/95 backdrop-blur-2xl border border-slate-700/60 rounded-3xl p-4 shadow-2xl space-y-3 select-none">
      {/* 顶部多标签导航 */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('agents')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium transition ${
              activeTab === 'agents'
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>活跃会话 ({agents.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('telemetry')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium transition ${
              activeTab === 'telemetry'
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>用量与限额</span>
          </button>

          <button
            onClick={() => setActiveTab('plan')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium transition ${
              activeTab === 'plan'
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>任务计划</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium transition ${
              activeTab === 'audit'
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>安全审计 ({auditList.length})</span>
          </button>
        </div>
      </div>

      {/* 活跃会话标签页 */}
      {activeTab === 'agents' && (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {agents.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              暂无检测到运行中的 AI Agent 终端会话
            </div>
          ) : (
            agents.map((agent) => {
              const isWaiting = agent.status === 'waiting';
              const isRunning = agent.status === 'running';
              const isError = agent.status === 'error';

              return (
                <div
                  key={agent.id}
                  className={`flex items-center justify-between p-3 rounded-2xl bg-slate-950/60 border transition ${
                    isWaiting
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : isRunning
                      ? 'border-cyan-500/30'
                      : 'border-slate-800/80'
                  }`}
                >
                  <div className="space-y-1 overflow-hidden pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isWaiting
                            ? 'bg-amber-400 animate-pulse'
                            : isRunning
                            ? 'bg-cyan-400 animate-pulse'
                            : isError
                            ? 'bg-rose-400'
                            : 'bg-emerald-400'
                        }`}
                      />
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        {agent.name}
                      </span>
                      {agent.cwd && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800/80 text-slate-400 font-mono">
                          {agent.cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop()}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {agent.lastMessage || '等待下一轮响应...'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => onFocus(agent.pid, agent.name, agent.cwd)}
                      className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-cyan-500/20 hover:text-cyan-300 text-slate-300 border border-slate-700 transition"
                      title="唤醒并置顶对应终端"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>切回</span>
                    </button>

                    <button
                      onClick={() => onAbort(agent.id, agent.pid)}
                      className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      title="中断会话 (Ctrl+C)"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 速率与用量标签页 */}
      {activeTab === 'telemetry' && (
        <RateLimitRadar telemetry={telemetry} />
      )}

      {/* 任务计划标签页 */}
      {activeTab === 'plan' && (
        <div className="space-y-2">
          {activePlan ? (
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 truncate">
                  {activePlan.title}
                </span>
                <span className="text-[10px] text-cyan-400 font-mono font-bold">
                  {activePlan.completedTasks} / {activePlan.totalTasks} 项已就绪
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-300"
                  style={{
                    width: `${activePlan.totalTasks > 0 ? (activePlan.completedTasks / activePlan.totalTasks) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="text-[10px] text-slate-400 font-mono truncate">
                {activePlan.path}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500 text-xs">
              当前未发现进行中的 Plan 任务文档
            </div>
          )}
        </div>
      )}

      {/* 安全审计标签页 */}
      {activeTab === 'audit' && (
        <AuditHistoryTab auditList={auditList} onClear={onClearAudit} />
      )}
    </div>
  );
};
