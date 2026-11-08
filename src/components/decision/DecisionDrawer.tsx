import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, X, ShieldAlert, Terminal, HelpCircle, StopCircle, CornerDownLeft, Copy, CheckCheck } from 'lucide-react';
import type { DecisionRequest } from '../../vite-env';
import { analyzeCommandRisk } from '../../utils/risk';
import { soundManager } from '../../utils/audio';

interface DecisionDrawerProps {
  decision: DecisionRequest;
  onResolve: (action: 'allow' | 'deny' | 'ask', selectedOption?: string) => void;
  onAbort?: (sessionId: string, pid?: number) => void;
  onFocus?: (pid?: number, nameHint?: string, cwdHint?: string) => void;
}

export const DecisionDrawer: React.FC<DecisionDrawerProps> = ({
  decision,
  onResolve,
  onAbort,
  onFocus,
}) => {
  const [customReply, setCustomReply] = useState('');
  const [copied, setCopied] = useState(false);
  const risk = analyzeCommandRisk(decision.command);
  const isQuestion = decision.type === 'question' || !!decision.question;

  const handleAction = (action: 'allow' | 'deny', option?: string) => {
    soundManager.playClick();
    onResolve(action, option || customReply || undefined);
    // 审批后自动切回终端窗口，保持开发心流无缝衔接
    onFocus?.(decision.pid, decision.agent_name, decision.cwd);
  };

  const handleAbort = () => {
    soundManager.playDanger();
    if (decision.session_id) {
      onAbort?.(decision.session_id, decision.pid);
    }
  };

  const handleCopy = () => {
    if (decision.command) {
      navigator.clipboard.writeText(decision.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 支持极速数字单键审批：按 1 批准，按 2 拒绝 (Enter 默认批准 / 1-9 答题)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 若当前焦点在 input 框中且不是按 Enter 则不抢占输入
      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Enter') {
          handleAction('allow', customReply);
        }
        return;
      }

      // 1. 如果是提问模式且带有候选选项，数字键 1-9 直接对应选项
      if (isQuestion && decision.options && decision.options.length > 0) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= decision.options.length) {
          e.preventDefault();
          const targetOpt = decision.options[num - 1];
          const label = typeof targetOpt === 'string' ? targetOpt : targetOpt.label;
          handleAction('allow', label);
          return;
        }
      }

      const key = e.key.toLowerCase();

      // 2. 常规审批模式：单键 1 批准，单键 2 拒绝 (兼顾 Enter 与 Y/N 习惯)
      if (e.key === '1' || (!isQuestion && (e.key === 'Enter' || key === 'y'))) {
        e.preventDefault();
        handleAction('allow');
        return;
      }
      if (e.key === '2' || (!isQuestion && (key === 'n' || e.key === 'Escape'))) {
        e.preventDefault();
        handleAction('deny');
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQuestion, decision.options, customReply]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -6 }}
      transition={{ duration: 0.2 }}
      className="w-full bg-slate-900/95 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-4 shadow-2xl space-y-3"
    >
      {/* 顶栏：来源 Agent 与风险评估标签 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isQuestion ? (
            <HelpCircle className="w-4 h-4 text-sky-400" />
          ) : (
            <ShieldAlert className={`w-4 h-4 ${risk.color}`} />
          )}
          <span className="text-xs font-semibold text-slate-200">
            {decision.agent_name || 'AI Agent'}
          </span>
          {decision.cwd && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
              {decision.cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isQuestion && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${risk.bgColor} ${risk.color} border ${risk.borderColor}`}>
              {risk.label}
            </span>
          )}
          <button
            onClick={() => onFocus?.(decision.pid, decision.agent_name, decision.cwd)}
            className="text-[10px] text-slate-400 hover:text-cyan-400 transition"
            title="聚焦定位到终端窗口"
          >
            {decision.pid ? `PID: ${decision.pid}` : '切回终端'}
          </button>
        </div>
      </div>

      {/* 提问内容或命令正文 */}
      {isQuestion ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-100 font-medium leading-relaxed">
            {decision.question || 'Agent 正在等待您的决策输入：'}
          </p>

          {/* 选项按钮组 */}
          {decision.options && decision.options.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {decision.options.map((opt, idx) => {
                const label = typeof opt === 'string' ? opt : opt.label;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAction('allow', label)}
                    className="text-left text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 hover:border-cyan-500/50 border border-slate-700/60 text-slate-200 hover:text-cyan-200 transition font-mono truncate group"
                  >
                    <span className="text-cyan-400 mr-1.5 font-bold group-hover:text-cyan-300">
                      [{idx + 1}]
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>执行工具: <strong className="text-slate-300 font-mono">{decision.tool_name || 'Bash'}</strong></span>
            </div>
            {decision.command && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition"
              >
                {copied ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? '已复制' : '复制命令'}</span>
              </button>
            )}
          </div>

          <div className="relative group bg-slate-950/80 rounded-xl p-2.5 border border-slate-800 font-mono text-[11px] text-slate-200 max-h-28 overflow-y-auto select-text">
            <code>{decision.command || '(无具体命令内容)'}</code>
          </div>
          {risk.description && (
            <p className="text-[10px] text-slate-400 italic">
              {risk.description}
            </p>
          )}
        </div>
      )}

      {/* 快速追问/补充输入框 */}
      <div className="flex items-center gap-1.5 bg-slate-950/50 border border-slate-800 rounded-xl px-2.5 py-1">
        <input
          type="text"
          value={customReply}
          onChange={(e) => setCustomReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAction('allow', customReply);
          }}
          placeholder="补充指令或自定义答复 (按 Enter 提交)..."
          className="w-full bg-transparent text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none"
        />
        <button
          onClick={() => handleAction('allow', customReply)}
          disabled={!customReply.trim()}
          className="p-1 rounded text-slate-400 hover:text-cyan-400 disabled:opacity-30 transition"
        >
          <CornerDownLeft className="w-3 h-3" />
        </button>
      </div>

      {/* 底部动作条：批准、拒绝、紧急熔断 */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleAbort}
          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition"
          title="终止此任务进程 (Ctrl+C)"
        >
          <StopCircle className="w-3 h-3" />
          <span>中断任务</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction('deny')}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            <span className="w-4 h-4 rounded bg-rose-500/20 text-rose-400 font-mono text-[10px] flex items-center justify-center border border-rose-500/30">2</span>
            <X className="w-3 h-3 text-rose-400" />
            <span>拒绝</span>
          </button>

          <button
            onClick={() => handleAction('allow')}
            className="flex items-center gap-1.5 text-[11px] px-3.5 py-1 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium shadow-lg shadow-cyan-500/20 transition"
          >
            <span className="w-4 h-4 rounded bg-white/20 text-white font-mono text-[10px] flex items-center justify-center">1</span>
            <Check className="w-3 h-3" />
            <span>批准运行</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
};
