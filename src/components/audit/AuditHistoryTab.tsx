import React from 'react';
import { History, Trash2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { AuditRecord } from '../../vite-env';

interface AuditHistoryTabProps {
  auditList: AuditRecord[];
  onClear: () => void;
}

export const AuditHistoryTab: React.FC<AuditHistoryTabProps> = ({ auditList, onClear }) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span className="flex items-center gap-1.5 font-medium">
          <History className="w-3.5 h-3.5 text-slate-400" />
          安全拦截与决策回溯 (最近 {auditList.length} 条)
        </span>
        {auditList.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-rose-400 transition"
          >
            <Trash2 className="w-3 h-3" />
            <span>清空记录</span>
          </button>
        )}
      </div>

      {auditList.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-xs">
          暂无安全审计记录
        </div>
      ) : (
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
          {auditList.map((item) => {
            const isAllow = item.action === 'allow';
            const isDeny = item.action === 'deny';
            return (
              <div
                key={item.id}
                className="bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 text-[11px] space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium text-slate-200">
                    {isAllow && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                    {isDeny && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                    {!isAllow && !isDeny && <Clock className="w-3.5 h-3.5 text-amber-400" />}
                    <span>{item.agent_name}</span>
                    {item.pid && <span className="text-[10px] text-slate-400">({item.pid})</span>}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="font-mono text-[10px] bg-slate-950/70 rounded p-1.5 text-slate-300 break-all select-text">
                  {item.command || item.tool_name}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
