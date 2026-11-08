import React from 'react';
import { motion } from 'framer-motion';
import { Terminal, ShieldAlert, Sparkles, Volume2, VolumeX, BellOff, ChevronDown } from 'lucide-react';
import { AuraGlow } from './AuraGlow';
import type { AgentSession } from '../deck/CommandDeck';
import type { DecisionRequest } from '../../vite-env';

interface IslandPillProps {
  agents: AgentSession[];
  activeDecision: DecisionRequest | null;
  isHovered: boolean;
  isExpanded: boolean;
  isMuted: boolean;
  isDnd: boolean;
  onToggleExpand: () => void;
  onToggleMute: () => void;
  quickFeedback: { msg: string; action: 'allow' | 'deny' } | null;
}

export const IslandPill: React.FC<IslandPillProps> = ({
  agents,
  activeDecision,
  isHovered,
  isExpanded,
  isMuted,
  isDnd,
  onToggleExpand,
  onToggleMute,
  quickFeedback,
}) => {
  const runningAgent = agents.find(a => a.status === 'running');
  // 仅在存在当前实时待决决策时，才激活醒目的琥珀黄色警报
  const hasWaiting = !!activeDecision;

  let overallStatus: 'idle' | 'running' | 'waiting' | 'completed' | 'error' = 'idle';
  if (hasWaiting) overallStatus = 'waiting';
  else if (runningAgent) overallStatus = 'running';
  else if (agents.some(a => a.status === 'error')) overallStatus = 'error';
  else if (agents.some(a => a.status === 'completed')) overallStatus = 'completed';

  return (
    <div className="relative group select-none">
      <AuraGlow status={overallStatus} isHovered={isHovered} hasWaiting={hasWaiting} />

      <motion.div
        layout
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 450, damping: 26 }}
        onClick={onToggleExpand}
        className={`relative flex items-center justify-between px-3.5 py-1.5 rounded-full backdrop-blur-2xl cursor-pointer transition-colors duration-200 ${
          hasWaiting
            ? 'bg-slate-900/95 border border-amber-500/60 shadow-lg shadow-amber-500/20'
            : runningAgent
            ? 'bg-slate-900/90 border border-cyan-500/50 shadow-lg shadow-cyan-500/15'
            : 'bg-slate-900/85 border border-slate-700/60 hover:border-slate-500'
        }`}
      >
        {/* 左侧：状态指示器与 Agent 标识 */}
        <div className="flex items-center gap-2">
          {quickFeedback ? (
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="flex items-center gap-1.5 text-xs font-bold text-amber-300"
            >
              <Sparkles className="w-3.5 h-3.5 animate-spin" />
              <span>{quickFeedback.msg}</span>
            </motion.div>
          ) : hasWaiting ? (
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span className="text-xs font-bold text-amber-300">
                {activeDecision?.agent_name || '等待决策'}
              </span>
            </div>
          ) : runningAgent ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs font-medium text-cyan-300">
                {runningAgent.name}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-300 tracking-wide">
                Google Antigravity
              </span>
            </div>
          )}

          {/* 活跃会话数小角标 */}
          {agents.length > 0 && !quickFeedback && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {agents.length}
            </span>
          )}
        </div>

        {/* 右侧：状态图标与折叠指示 */}
        <div className="flex items-center gap-2 pl-3">
          {isDnd && <BellOff className="w-3 h-3 text-amber-400" />}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            className="text-slate-500 hover:text-slate-300 transition"
            title={isMuted ? '取消静音 (Alt+M)' : '开启静音 (Alt+M)'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${
              isExpanded ? 'rotate-180 text-cyan-400' : ''
            }`}
          />
        </div>
      </motion.div>
    </div>
  );
};
