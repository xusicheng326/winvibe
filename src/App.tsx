import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal,
  ShieldAlert,
  ChevronDown,
  Sparkles,
  Clock,
  Check,
  X,
  ExternalLink,
  Layers,
  History,
  Trash2,
  ShieldCheck,
  FileText,
  Volume2,
  VolumeX,
  CheckCircle2,
  Circle,
  RefreshCw,
} from 'lucide-react';
import type { AuditRecord, DecisionRequest, ActivePlan } from './vite-env';
import { soundManager } from './utils/audio';

interface AgentSession {
  id: string;
  name: string;
  status: 'running' | 'waiting' | 'completed' | 'error';
  lastMessage: string;
  startTime: number;
  pid?: number;
  sessionId?: string;
  cwd?: string;
  source?: 'hook' | 'log' | 'process';
}

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const [isDnd, setIsDnd] = useState(false);
  const [activeTab, setActiveTab] = useState<'agents' | 'plan' | 'audit'>('agents');
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [isMuted, setIsMuted] = useState(soundManager.isMuted());
  const [quickFeedback, setQuickFeedback] = useState<{ msg: string; action: 'allow' | 'deny' } | null>(null);
  const [decisionQueue, setDecisionQueue] = useState<DecisionRequest[]>([]);
  const [agents, setAgents] = useState<AgentSession[]>([]);
  const [auditList, setAuditList] = useState<AuditRecord[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentDecision = decisionQueue[0] || null;

  const fetchActivePlan = () => {
    window.winvibe?.getActivePlan?.().then((plan) => {
      if (plan) setActivePlan(plan);
    }).catch(() => {});
  };

  const handleToggleMute = () => {
    const muted = soundManager.toggleMute();
    setIsMuted(muted);
  };

  // 动态点击穿透管理：当鼠标进入交互区域时关闭穿透；移出且无弹窗时恢复穿透
  const handleMouseEnter = () => {
    setIsHovered(true);
    window.winvibe?.setIgnoreMouseEvents(false);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (!currentDecision) {
      window.winvibe?.setIgnoreMouseEvents(true, true);
    }
  };

  // 监听来自 Electron 后端的真实事件
  useEffect(() => {
    if (!window.winvibe) return;

    // 获取初次审计日志与活跃计划
    window.winvibe.getAuditHistory?.().then((records) => {
      if (records) setAuditList(records);
    });
    fetchActivePlan();

    // 监听审批与提问请求（防止重复添加相同 request_id）
    const unbindDecision = window.winvibe.onDecisionRequest((req: DecisionRequest) => {
      soundManager.playAttention();
      setDecisionQueue((prev) => {
        if (prev.some((r) => r.request_id === req.request_id)) return prev;
        return [...prev, req];
      });
      window.winvibe?.setIgnoreMouseEvents(false);
    });

    // 监听状态通知
    const unbindEvent = window.winvibe.onAgentEvent((ev: any) => {
      console.log('[React App] Received agent event:', ev);
      if (ev.status === 'completed') {
        soundManager.playSuccess();
      }
      setAgents((prev) => {
        const id = ev.session_id || ev.agent_name || 'agent';
        const index = prev.findIndex((a) => a.id === id);
        const updated: AgentSession = {
          id,
          name: ev.agent_name || 'AI Agent',
          status: ev.status === 'completed' ? 'completed' : ev.status === 'error' ? 'error' : 'running',
          lastMessage: ev.message || ev.title || 'Executing...',
          startTime: Date.now(),
          pid: ev.pid,
        };
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...next[index], ...updated, startTime: prev[index].startTime };
          return next;
        }
        return [updated, ...prev];
      });
    });

    // 监听全量活跃 Agent 同步（多实例感知与自动清理）
    const unbindSync = window.winvibe.onActiveAgentsSync?.((syncedAgents: AgentSession[]) => {
      setAgents(syncedAgents);

      // 智能自动消除：如果所有 Agent 都已经不是 waiting 状态，自动清空终端 CLI 提问卡片
      const hasWaiting = syncedAgents.some(a => a.status === 'waiting');
      if (!hasWaiting) {
        setDecisionQueue((prev) => {
          // 保留来自 Hook API 的显式阻塞决策（req- 开头），消除自动感知的 CLI 提问（agy- 开头）
          const filtered = prev.filter(r => r.request_id.startsWith('req-'));
          if (filtered.length === 0 && !isHovered) {
            window.winvibe?.setIgnoreMouseEvents(true, true);
          }
          return filtered;
        });
      }
    });

    // 监听审计记录实时更新
    const unbindAudit = window.winvibe.onAuditHistoryUpdated?.((records: AuditRecord[]) => {
      setAuditList(records);
    });

    // 监听全局快捷键决策消除或状态变更自动消除
    const unbindResolved = window.winvibe.onDecisionResolved?.(({ requestId }) => {
      setDecisionQueue((prev) => {
        if (requestId === 'agy-all') {
          return prev.filter((r) => !r.request_id.startsWith('agy-'));
        }
        return prev.filter((r) => r.request_id !== requestId);
      });
    });

    // 监听全局快捷键切换展开 (Alt+Shift+V)
    const unbindToggle = window.winvibe.onToggleExpand?.(() => {
      setIsManuallyExpanded((prev) => !prev);
      window.winvibe?.setIgnoreMouseEvents(false);
    });

    // 监听免打扰状态
    const unbindDnd = window.winvibe.onDndToggle?.((dnd: boolean) => {
      setIsDnd(dnd);
    });

    // 监听全局快捷键直接处理当前决策 (Alt+Y 允许 / Alt+N 拒绝)
    const unbindShortcut = window.winvibe.onShortcutDecision?.((action: 'allow' | 'deny') => {
      setDecisionQueue((prev) => {
        if (prev.length === 0) return prev;
        const target = prev[0];
        window.winvibe?.sendDecision(target.request_id, action);
        if (prev.length <= 1 && !isHovered) {
          window.winvibe?.setIgnoreMouseEvents(true, true);
        }
        return prev.slice(1);
      });
    });

    // 监听向终端快速响应反馈
    const unbindQuickFeedback = window.winvibe.onAgentQuickFeedback?.((data) => {
      const isY = data.action === 'allow';
      const msg = data.message || `已向 ${data.agentName} 发送 [${data.key}] 响应`;
      setQuickFeedback({
        msg,
        action: isY ? 'allow' : 'deny'
      });
      setTimeout(() => setQuickFeedback(null), 3000);
    });

    return () => {
      unbindDecision();
      unbindEvent();
      unbindSync?.();
      unbindAudit?.();
      unbindResolved?.();
      unbindToggle?.();
      unbindDnd?.();
      unbindShortcut?.();
      unbindQuickFeedback?.();
    };
  }, [isHovered]);

  // 处理审批决策点击或结构化选项回答
  const handleDecision = (action: 'allow' | 'deny', selectedOption?: string) => {
    if (!currentDecision) return;
    if (action === 'allow') {
      soundManager.playSuccess();
    } else {
      soundManager.playDeny();
    }
    window.winvibe?.sendDecision(currentDecision.request_id, action, selectedOption);
    setDecisionQueue((prev) => prev.slice(1));
    if (decisionQueue.length <= 1 && !isHovered) {
      window.winvibe?.setIgnoreMouseEvents(true, true);
    }
  };

  // 唤醒聚焦终端窗口
  const handleJumpToTerminal = (pid?: number) => {
    if (pid && window.winvibe) {
      window.winvibe.focusWindow(pid);
    }
  };

  // 清空历史审计记录
  const handleClearAudit = () => {
    window.winvibe?.clearAuditHistory?.();
    setAuditList([]);
  };

  // 模拟测试数据（用于开发调试）
  const triggerMockDecision = () => {
    const mock: DecisionRequest = {
      request_id: `mock-${Date.now()}`,
      agent_name: 'Claude Code',
      tool_name: 'Bash',
      command: 'git push origin main --force',
      cwd: 'D:\\vibe\\agent',
      pid: process.pid,
    };
    setDecisionQueue((prev) => [...prev, mock]);
    window.winvibe?.setIgnoreMouseEvents(false);
  };

  const isAttention = !!currentDecision && !isDnd;
  const isExpanded = (isHovered || isManuallyExpanded) && !isAttention;

  return (
    <div className="w-full h-full flex flex-col items-center justify-start pt-1 font-sans">
      <motion.div
        ref={containerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        layout
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        className={`relative z-50 text-white transition-all duration-200 overflow-hidden ${
          isAttention
            ? 'rounded-2xl border border-amber-500/60'
            : isExpanded
            ? 'rounded-2xl border border-white/20'
            : 'rounded-full border border-white/20 hover:border-white/40'
        }`}
        style={{
          backgroundColor: '#0f111a',
          boxShadow: isAttention
            ? '0 16px 45px rgba(0, 0, 0, 0.95), 0 0 20px rgba(245, 158, 11, 0.3)'
            : '0 12px 35px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          width: isAttention ? 450 : isExpanded ? 480 : quickFeedback ? 310 : 210,
          minHeight: isAttention ? 128 : isExpanded ? 280 : 36,
        }}
      >
        <AnimatePresence mode="wait">
          {/* ================= 模式 1: 待审批决策态 (Attention Mode) ================= */}
          {isAttention && currentDecision && (
            <motion.div
              key="attention"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="p-3.5 flex flex-col justify-between h-full"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-2.5 w-2.5 relative">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${
                      currentDecision.type === 'complex_question' ? 'bg-purple-400' : currentDecision.type === 'question' ? 'bg-blue-400' : 'bg-amber-400'
                    } opacity-75`}></span>
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      currentDecision.type === 'complex_question' ? 'bg-purple-500' : currentDecision.type === 'question' ? 'bg-blue-500' : 'bg-amber-500'
                    }`}></span>
                  </span>
                  <span className={`text-xs font-semibold flex items-center gap-1.5 ${
                    currentDecision.type === 'complex_question' ? 'text-purple-300' : currentDecision.type === 'question' ? 'text-blue-300' : 'text-amber-300'
                  }`}>
                    <ShieldAlert className="w-3.5 h-3.5" />
                    {currentDecision.agent_name}
                    <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-white/10 text-zinc-300">
                      {currentDecision.type === 'complex_question' ? '复杂问题待输入' : currentDecision.type === 'question' ? '选择题待回答' : '权限请求审批'}
                    </span>
                    {decisionQueue.length > 1 && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded-full font-mono flex items-center gap-0.5">
                        <Layers className="w-2.5 h-2.5" />
                        1/{decisionQueue.length}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {currentDecision.pid && (
                    <button
                      onClick={() => handleJumpToTerminal(currentDecision.pid)}
                      title="点击切回该终端窗口 (Jump-Back)"
                      className="text-[10px] text-zinc-300 hover:text-white bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded flex items-center gap-1 transition cursor-pointer"
                    >
                      <ExternalLink className="w-2.5 h-2.5 text-emerald-400" />
                      直达终端
                    </button>
                  )}
                  <span className="text-[10px] text-zinc-400 font-mono bg-white/5 px-2 py-0.5 rounded">
                    {currentDecision.tool_name}
                  </span>
                </div>
              </div>

              {/* 卡片核心内容呈现区（简单问题 / 权限请求 / 复杂问题） */}
              {currentDecision.type === 'complex_question' ? (
                /* 复杂问题：展示问题摘要并提供一键跳转终端输入 */
                <div 
                  onClick={() => handleJumpToTerminal(currentDecision.pid)}
                  className="bg-black/60 rounded-md p-2.5 border border-purple-500/30 my-1 cursor-pointer hover:border-purple-500/60 transition group"
                  title="点击直接跳转到该终端输入答案"
                >
                  <div className="text-[11px] text-zinc-100 font-medium select-text leading-relaxed">
                    {currentDecision.question || currentDecision.summary || 'Agent 需要您提供详细输入或指令...'}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-purple-300 mt-2 font-mono">
                    <span className="flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" />
                      点击跳转终端继续回答
                    </span>
                    <span className="text-zinc-500">按回车或输入内容</span>
                  </div>
                </div>
              ) : currentDecision.type === 'question' || (currentDecision.options && currentDecision.options.length > 0) ? (
                /* 简单问题（选择题）：直接展示题目与选项列表 */
                <div className="bg-black/60 rounded-md p-2 border border-blue-500/20 my-1">
                  <div className="text-[11px] text-zinc-100 mb-1.5 font-medium select-text">
                    {currentDecision.question || '请选择下一步操作：'}
                  </div>
                  {currentDecision.command && (
                    <div className="text-[10px] font-mono text-zinc-400 truncate">
                      {currentDecision.command}
                    </div>
                  )}
                </div>
              ) : (
                /* 权限请求：明确标明 Agent 要执行的操作命令与工作目录 */
                <div className="bg-black/60 rounded-md p-2 border border-amber-500/20 my-1">
                  <div className="text-[10px] text-amber-300/90 mb-1 font-medium">
                    即将执行命令：
                  </div>
                  <div className="text-[11px] font-mono text-zinc-200 break-all select-text bg-black/40 p-1.5 rounded">
                    <span className="text-emerald-400 select-none mr-1.5 font-bold">$</span>
                    {currentDecision.command || '未知指令'}
                  </div>
                  {currentDecision.cwd && (
                    <div className="text-[9px] text-zinc-500 mt-1 truncate font-mono">
                      in {currentDecision.cwd}
                    </div>
                  )}
                </div>
              )}

              {/* 底部操作区 */}
              {currentDecision.type === 'complex_question' ? (
                <div className="flex items-center justify-end gap-2 mt-1">
                  <button
                    onClick={() => handleJumpToTerminal(currentDecision.pid)}
                    className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-purple-500/20 text-purple-300 hover:bg-purple-500/35 border border-purple-500/40 transition-all cursor-pointer font-semibold shadow-sm"
                  >
                    <ExternalLink className="w-3 h-3" />
                    跳转终端输入
                  </button>
                  <button
                    onClick={() => handleDecision('deny')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white/5 text-zinc-400 hover:bg-white/10 transition-all cursor-pointer"
                  >
                    忽略
                  </button>
                </div>
              ) : currentDecision.options && currentDecision.options.length > 0 ? (
                /* 简单问题一键直答 */
                <div className="flex flex-wrap gap-1.5 mt-2 justify-end">
                  {currentDecision.options.map((opt, idx) => {
                    const label = typeof opt === 'string' ? opt : opt.label;
                    const val = typeof opt === 'string' ? opt : (opt.value || opt.label);
                    const key = typeof opt === 'string' ? String(idx + 1) : (opt.key || String(idx + 1));
                    return (
                      <button
                        key={idx}
                        onClick={() => handleDecision('allow', val)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium bg-blue-500/20 text-blue-200 hover:bg-blue-500/35 border border-blue-500/40 transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
                      >
                        <span className="text-[9px] bg-blue-400/30 text-blue-100 px-1 py-0.2 rounded font-mono font-bold">
                          {key}
                        </span>
                        {label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => handleDecision('deny')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-red-500/15 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-all cursor-pointer ml-1"
                  >
                    <X className="w-3 h-3" />
                    取消
                  </button>
                </div>
              ) : (
                /* 权限请求直接允许 / 拒绝 */
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    onClick={() => handleDecision('deny')}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-red-500/15 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-all cursor-pointer"
                    title="快捷键: Alt+N"
                  >
                    <X className="w-3 h-3" />
                    拒绝
                    <span className="text-[9px] bg-red-500/30 text-red-200 px-1 py-0.2 rounded font-mono ml-0.5">Alt+N</span>
                  </button>
                  <button
                    onClick={() => handleDecision('allow')}
                    className="flex items-center gap-1.5 px-3.5 py-1 rounded-md text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/35 border border-emerald-500/40 transition-all cursor-pointer font-semibold shadow-sm shadow-emerald-500/20"
                    title="快捷键: Alt+Y"
                  >
                    <Check className="w-3.5 h-3.5" />
                    允许
                    <span className="text-[9px] bg-emerald-500/35 text-emerald-100 px-1 py-0.2 rounded font-mono ml-0.5">Alt+Y</span>
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* ================= 模式 2: 展开看板态 (Expanded Mode) ================= */}
          {isExpanded && !isAttention && (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-3 flex flex-col h-full"
            >
              {/* 顶部标签切换栏 */}
              <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-2">
                <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/5">
                  <button
                    onClick={() => setActiveTab('agents')}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                      activeTab === 'agents'
                        ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    活跃会话
                    <span className="text-[10px] bg-white/10 px-1 rounded-full font-mono">
                      {agents.length}
                    </span>
                  </button>
                  <button
                    onClick={() => { setActiveTab('plan'); fetchActivePlan(); }}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                      activeTab === 'plan'
                        ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    计划审查
                    {activePlan && activePlan.totalTasks > 0 && (
                      <span className="text-[10px] bg-white/10 px-1 rounded-full font-mono">
                        {activePlan.completedTasks}/{activePlan.totalTasks}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('audit')}
                    className={`px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                      activeTab === 'audit'
                        ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-sm'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" />
                    安全审计
                    {auditList.length > 0 && (
                      <span className="text-[10px] bg-white/10 px-1 rounded-full font-mono">
                        {auditList.length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleToggleMute}
                    className={`p-1 rounded transition cursor-pointer ${
                      isMuted ? 'text-zinc-500 hover:text-zinc-300 bg-white/5' : 'text-emerald-400 hover:text-emerald-300 bg-emerald-500/10'
                    }`}
                    title={isMuted ? '8-bit 音效已静音，点击开启' : '8-bit 音效已开启，点击静音'}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>

                  {activeTab === 'agents' && (
                    <button
                      onClick={triggerMockDecision}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-zinc-300 transition cursor-pointer"
                      title="模拟 Claude Code 发起一次命令审批"
                    >
                      模拟审批
                    </button>
                  )}
                  {activeTab === 'plan' && (
                    <button
                      onClick={fetchActivePlan}
                      className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-zinc-300 transition cursor-pointer flex items-center gap-1"
                      title="重新扫描并读取最新计划文件"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      刷新
                    </button>
                  )}
                  {activeTab === 'audit' && (
                    <button
                      onClick={handleClearAudit}
                      disabled={auditList.length === 0}
                      className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 transition cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="清空审计日志"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                      清空
                    </button>
                  )}
                </div>
              </div>

              {/* 标签页内容：活跃会话 */}
              {activeTab === 'agents' && (
                <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[200px] pr-1">
                  {agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-36 text-center text-zinc-500">
                      <Sparkles className="w-6 h-6 text-emerald-500/40 mb-1.5" />
                      <p className="text-xs text-zinc-300 font-medium">暂无活跃的 Agent 会话</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        运行 OpenCode、Hermes、Antigravity 或 Claude Code 时自动在此呈现
                      </p>
                    </div>
                  ) : (
                    agents.map((agent) => (
                      <div
                        key={agent.id}
                        onClick={() => handleJumpToTerminal(agent.pid)}
                        className="p-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 transition flex items-center justify-between group cursor-pointer"
                        title="点击切回该终端窗口"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-2 w-2 rounded-full flex-shrink-0 ${
                              agent.status === 'waiting'
                                ? 'bg-amber-400 animate-pulse'
                                : agent.status === 'completed'
                                ? 'bg-blue-400'
                                : agent.status === 'error'
                                ? 'bg-red-400'
                                : 'bg-emerald-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-zinc-200 truncate flex items-center gap-1.5">
                              {agent.name}
                              {agent.status === 'waiting' && (
                                <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 py-0.2 rounded font-mono">
                                  等待回答
                                </span>
                              )}
                              {agent.pid && (
                                <span className="text-[9px] text-zinc-500 font-mono">
                                  PID:{agent.pid}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-400 truncate">
                              {agent.lastMessage}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-zinc-500 flex items-center gap-1 font-mono">
                            <Clock className="w-2.5 h-2.5" />
                            {Math.round((Date.now() - agent.startTime) / 1000)}s
                          </span>
                          <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-emerald-400 transition" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* 标签页内容：计划审查 (Plan Review) */}
              {activeTab === 'plan' && (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {!activePlan ? (
                    <div className="flex flex-col items-center justify-center h-36 text-center text-zinc-500">
                      <FileText className="w-6 h-6 text-zinc-600 mb-1.5" />
                      <p className="text-xs text-zinc-400 font-medium">当前未检测到活跃的 Agent 任务计划</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5 max-w-[320px]">
                        当 Agent 生成 PROJECT_PLAN.md 或规划文档时，将自动在此富文本呈现供您随时审查
                      </p>
                      <button
                        onClick={fetchActivePlan}
                        className="mt-2 text-[10px] px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 transition flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        重新扫描计划文件
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col min-h-0">
                      {/* 计划元信息与进度条 */}
                      <div className="bg-white/[0.03] border border-white/5 rounded-lg p-2 mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold text-zinc-200 truncate max-w-[280px]">
                              {activePlan.title}
                            </div>
                            <div className="text-[9px] text-zinc-500 font-mono truncate max-w-[280px]">
                              {activePlan.path}
                            </div>
                          </div>
                        </div>
                        {activePlan.totalTasks > 0 && (
                          <div className="flex flex-col items-end shrink-0 pl-2">
                            <span className="text-[10px] font-mono font-medium text-emerald-300">
                              {activePlan.completedTasks} / {activePlan.totalTasks} 完成
                            </span>
                            <div className="w-20 bg-white/10 h-1.5 rounded-full mt-1 overflow-hidden">
                              <div
                                className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${Math.round((activePlan.completedTasks / activePlan.totalTasks) * 100)}%`
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 计划富文本内容区域 */}
                      <div className="flex-1 overflow-y-auto max-h-[175px] pr-1 space-y-1.5 select-text text-zinc-300 font-sans text-[11px] leading-relaxed">
                        {activePlan.content.split('\n').map((line, idx) => {
                          const trimmed = line.trim();
                          if (!trimmed) return <div key={idx} className="h-0.5" />;

                          // 标题渲染
                          if (trimmed.startsWith('# ')) {
                            return <h1 key={idx} className="text-xs font-bold text-white mt-1 border-b border-white/10 pb-0.5">{trimmed.replace(/^#\s+/, '')}</h1>;
                          }
                          if (trimmed.startsWith('## ')) {
                            return <h2 key={idx} className="text-[11px] font-bold text-emerald-300 mt-1">{trimmed.replace(/^##\s+/, '')}</h2>;
                          }
                          if (trimmed.startsWith('### ')) {
                            return <h3 key={idx} className="text-[10px] font-semibold text-zinc-300 mt-0.5">{trimmed.replace(/^###\s+/, '')}</h3>;
                          }

                          // 复选框清单渲染
                          if (/^-\s*\[x\]/i.test(trimmed)) {
                            return (
                              <div key={idx} className="flex items-start gap-1.5 text-zinc-400 line-through text-[10px]">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{trimmed.replace(/^-\s*\[x\]\s*/i, '')}</span>
                              </div>
                            );
                          }
                          if (/^-\s*\[\s*\]/.test(trimmed)) {
                            return (
                              <div key={idx} className="flex items-start gap-1.5 text-zinc-200 font-medium text-[10px]">
                                <Circle className="w-3 h-3 text-zinc-500 shrink-0 mt-0.5" />
                                <span>{trimmed.replace(/^-\s*\[\s*\]\s*/, '')}</span>
                              </div>
                            );
                          }

                          // 引用块
                          if (trimmed.startsWith('>')) {
                            return (
                              <div key={idx} className="border-l-2 border-emerald-500/50 pl-2 text-[10px] text-zinc-400 italic bg-white/[0.02] py-0.5 rounded-r">
                                {trimmed.replace(/^>\s*/, '')}
                              </div>
                            );
                          }

                          // 普通文本
                          return (
                            <div key={idx} className="text-[10px] text-zinc-300">
                              {trimmed}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 标签页内容：安全审计历史 */}
              {activeTab === 'audit' && (
                <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[200px] pr-1">
                  {auditList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-36 text-center text-zinc-500">
                      <ShieldCheck className="w-6 h-6 text-zinc-600 mb-1.5" />
                      <p className="text-xs text-zinc-400 font-medium">暂无命令决策审计记录</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        每次拦截、允许或超时的 Bash 指令都将记录于此供安全追溯
                      </p>
                    </div>
                  ) : (
                    auditList.map((rec) => (
                      <div
                        key={rec.id}
                        className="p-2 rounded-lg bg-white/[0.03] border border-white/5 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-zinc-200">{rec.agent_name}</span>
                            <span className="text-[9px] text-zinc-400 font-mono bg-white/5 px-1 py-0.2 rounded">
                              {rec.tool_name}
                            </span>
                            {rec.pid && (
                              <span className="text-[9px] text-zinc-500 font-mono">
                                PID:{rec.pid}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                                rec.action === 'allow'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : rec.action === 'deny'
                                  ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {rec.action === 'allow'
                                ? '✅ 允许'
                                : rec.action === 'deny'
                                ? '❌ 拦截'
                                : '⏳ 超时'}
                            </span>
                            <span className="text-[9px] text-zinc-500 font-mono">
                              {new Date(rec.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                        <div className="bg-black/50 rounded px-1.5 py-1 font-mono text-[10px] text-zinc-300 break-all select-text">
                          <span className="text-emerald-400 select-none mr-1">$</span>
                          {rec.command}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* ================= 模式 3: 默认微缩胶囊态 (Capsule Mode) ================= */}
          {!isAttention && !isExpanded && (
            <motion.div
              key="capsule"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-9 px-3 flex items-center justify-between cursor-pointer"
            >
              {quickFeedback ? (
                <div className="flex items-center gap-1.5 text-xs font-medium w-full justify-center">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      quickFeedback.action === 'allow' ? 'bg-emerald-400' : 'bg-red-400'
                    } animate-ping`}
                  />
                  <span
                    className={
                      quickFeedback.action === 'allow' ? 'text-emerald-300' : 'text-red-300'
                    }
                  >
                    {quickFeedback.msg}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-xs font-medium tracking-tight text-zinc-300 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                      WinVibe
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-zinc-400">
                    <span className="bg-white/10 px-1.5 py-0.2 rounded text-[10px] text-emerald-300">
                      {agents.length}
                    </span>
                    <ChevronDown className="w-3 h-3 text-zinc-500" />
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
