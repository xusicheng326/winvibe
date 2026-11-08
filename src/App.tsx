import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AuditRecord, DecisionRequest, ActivePlan } from './vite-env';
import { soundManager } from './utils/audio';
import { IslandPill } from './components/island/IslandPill';
import { DecisionDrawer } from './components/decision/DecisionDrawer';
import { CommandDeck, type AgentSession } from './components/deck/CommandDeck';
import type { TelemetryData } from './components/telemetry/RateLimitRadar';

export default function App() {
  const [isHovered, setIsHovered] = useState(false);
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const [isDnd, setIsDnd] = useState(false);
  const [isMuted, setIsMuted] = useState(soundManager.isMuted());
  const [activeTab, setActiveTab] = useState<'agents' | 'plan' | 'telemetry' | 'audit'>('agents');
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [quickFeedback, setQuickFeedback] = useState<{ msg: string; action: 'allow' | 'deny' } | null>(null);

  const [decisionQueue, setDecisionQueue] = useState<DecisionRequest[]>([]);
  const [agents, setAgents] = useState<AgentSession[]>([]);
  const [auditList, setAuditList] = useState<AuditRecord[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);

  const currentDecision = decisionQueue[0] || null;

  useEffect(() => {
    if (currentDecision) {
      window.winvibe?.setTargetSession?.(currentDecision.request_id);
    } else {
      window.winvibe?.setTargetSession?.(null);
    }
  }, [currentDecision?.request_id]);

  // 鼠标穿透管理：仅在鼠标进入实际交互区域（灵动岛胶囊或展开内容）时捕获鼠标
  const shouldCaptureMouse = isHovered || isManuallyExpanded || !!currentDecision;

  useEffect(() => {
    window.winvibe?.setIgnoreMouseEvents?.(!shouldCaptureMouse, true);
  }, [shouldCaptureMouse]);

  useEffect(() => {
    window.winvibe?.getActivePlan?.().then((plan) => {
      if (plan) setActivePlan(plan);
    }).catch(() => {});

    window.winvibe?.getTelemetry?.().then((t) => {
      if (t) setTelemetry(t);
    }).catch(() => {});

    window.winvibe?.getAuditHistory?.().then((history) => {
      if (history) setAuditList(history);
    }).catch(() => {});
  }, []);

  // 联动主进程物理窗口尺寸与失焦自动收起
  useEffect(() => {
    window.winvibe?.setWindowExpanded?.(isManuallyExpanded || !!currentDecision);
  }, [isManuallyExpanded, !!currentDecision]);

  // 全局 Escape 键一键收起展开面板，M 键快捷切换静音
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isManuallyExpanded) {
        setIsManuallyExpanded(false);
      } else if ((e.key === 'm' || e.key === 'M') && isManuallyExpanded && document.activeElement?.tagName !== 'INPUT') {
        const muted = soundManager.toggleMute();
        setIsMuted(muted);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isManuallyExpanded]);

  useEffect(() => {
    const unsubReq = window.winvibe?.onDecisionRequest?.((req) => {
      setDecisionQueue((prev) => {
        if (prev.some(r => r.request_id === req.request_id)) return prev;
        soundManager.playAttention();
        return [...prev, req];
      });
    });

    const unsubResolved = window.winvibe?.onDecisionResolved?.((data) => {
      setDecisionQueue((prev) => prev.filter(r => r.request_id !== data.requestId));
      if (data.requestId === 'all' || data.action === 'dismiss') {
        setDecisionQueue([]);
      }
    });

    const unsubSync = window.winvibe?.onActiveAgentsSync?.((syncedAgents) => {
      setAgents(syncedAgents || []);
    });

    const unsubAudit = window.winvibe?.onAuditHistoryUpdated?.((records) => {
      setAuditList(records || []);
    });

    const unsubTelemetry = window.winvibe?.onTelemetryUpdated?.((t) => {
      setTelemetry(t);
    });

    const unsubToggle = window.winvibe?.onToggleExpand?.(() => {
      setIsManuallyExpanded(prev => !prev);
    });

    const unsubMute = window.winvibe?.onToggleMute?.(() => {
      const muted = soundManager.toggleMute();
      setIsMuted(muted);
    });

    const unsubDnd = window.winvibe?.onDndToggle?.((dnd) => {
      setIsDnd(dnd);
    });

    const unsubCollapse = window.winvibe?.onAutoCollapse?.(() => {
      setIsManuallyExpanded(false);
    });

    const unsubShortcut = window.winvibe?.onShortcutDecision?.((_action) => {
      if (currentDecision) {
        soundManager.playClick();
        // 主进程已在后台完成发键与仲裁，前端直接出队，杜绝回环重复发键导致程序异常退出
        setDecisionQueue((prev) => prev.filter(r => r.request_id !== currentDecision.request_id));
      }
    });

    const unsubFeedback = window.winvibe?.onAgentQuickFeedback?.((data) => {
      setQuickFeedback({
        msg: `已${data.action === 'allow' ? '批准' : '拒绝'} (${data.agentName})`,
        action: data.action as 'allow' | 'deny',
      });
      setTimeout(() => setQuickFeedback(null), 2500);
    });

    return () => {
      unsubReq?.();
      unsubResolved?.();
      unsubSync?.();
      unsubAudit?.();
      unsubTelemetry?.();
      unsubToggle?.();
      unsubMute?.();
      unsubDnd?.();
      unsubCollapse?.();
      unsubShortcut?.();
      unsubFeedback?.();
    };
  }, []);

  const handleResolveDecision = (action: 'allow' | 'deny' | 'ask', selectedOption?: string) => {
    if (!currentDecision) return;
    window.winvibe?.sendDecision?.(currentDecision.request_id, action, selectedOption);
    setDecisionQueue((prev) => prev.filter(r => r.request_id !== currentDecision.request_id));
  };

  const handleFocus = (pid?: number, nameHint?: string, cwdHint?: string) => {
    window.winvibe?.focusWindow?.(pid, nameHint, cwdHint);
  };

  const handleAbort = (sessionId: string, pid?: number) => {
    window.winvibe?.abortSession?.(sessionId, pid);
  };

  const handleClearAudit = () => {
    window.winvibe?.clearAuditHistory?.();
    setAuditList([]);
  };

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="w-full flex flex-col items-center pt-2 px-4 font-sans select-none relative"
    >
      {/* 展开态点击外部空白区域自动收起遮罩 */}
      {isManuallyExpanded && (
        <div
          onClick={() => setIsManuallyExpanded(false)}
          className="fixed inset-0 z-0 bg-transparent cursor-default"
          title="点击空白处收起控制台"
        />
      )}

      {/* 顶部灵动岛胶囊 */}
      <div className="z-10">
        <IslandPill
          agents={agents}
          activeDecision={currentDecision}
          isHovered={isHovered}
          isExpanded={isManuallyExpanded}
          isMuted={isMuted}
          isDnd={isDnd}
          onToggleExpand={() => setIsManuallyExpanded(prev => !prev)}
          onToggleMute={() => {
            const m = soundManager.toggleMute();
            setIsMuted(m);
          }}
          quickFeedback={quickFeedback}
        />
      </div>

      {/* 挂起的决策卡片或展开面板 */}
      <div className="w-full max-w-xl mt-2 z-10">
        <AnimatePresence>
          {currentDecision && !isManuallyExpanded && (
            <DecisionDrawer
              decision={currentDecision}
              onResolve={handleResolveDecision}
              onAbort={handleAbort}
              onFocus={handleFocus}
            />
          )}

          {isManuallyExpanded && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
              className="space-y-2.5"
            >
              {currentDecision && (
                <DecisionDrawer
                  decision={currentDecision}
                  onResolve={handleResolveDecision}
                  onAbort={handleAbort}
                  onFocus={handleFocus}
                />
              )}
              <CommandDeck
                agents={agents}
                activePlan={activePlan}
                auditList={auditList}
                telemetry={telemetry}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onFocus={handleFocus}
                onAbort={handleAbort}
                onClearAudit={handleClearAudit}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
