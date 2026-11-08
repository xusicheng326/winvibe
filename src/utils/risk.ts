export type RiskLevel = 'safe' | 'warning' | 'critical';

export interface CommandRisk {
  level: RiskLevel;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}

export function analyzeCommandRisk(command?: string): CommandRisk {
  if (!command) {
    return {
      level: 'safe',
      label: '安全',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/30',
      description: '常规操作',
    };
  }

  const cleanCmd = command.trim().toLowerCase();

  // 极度危险指令
  if (
    /rm\s+(-[a-z]*r[a-z]*f|--recursive|-[a-z]*f[a-z]*r)/i.test(cleanCmd) ||
    /git\s+push\s+.*--force/i.test(cleanCmd) ||
    /git\s+reset\s+--hard/i.test(cleanCmd) ||
    /drop\s+database|truncate\s+table/i.test(cleanCmd) ||
    /format\s+[a-z]:/i.test(cleanCmd) ||
    /del\s+\/f\s+\/s\s+\/q/i.test(cleanCmd) ||
    /:(){ :\|:& };:/i.test(cleanCmd)
  ) {
    return {
      level: 'critical',
      label: '高危破坏性指令',
      color: 'text-red-400',
      bgColor: 'bg-red-500/20',
      borderColor: 'border-red-500/50',
      description: '包含不可逆删除、强制重置或系统级改动，请极其审慎！',
    };
  }

  // 警告级别指令：写入、安装、进程管理
  if (
    /npm\s+(i|install|update|publish)/i.test(cleanCmd) ||
    /pip\s+install/i.test(cleanCmd) ||
    /cargo\s+install/i.test(cleanCmd) ||
    /pnpm\s+(add|install)/i.test(cleanCmd) ||
    /yarn\s+(add|install)/i.test(cleanCmd) ||
    /git\s+(commit|merge|rebase)/i.test(cleanCmd) ||
    /taskkill|pkill|kill/i.test(cleanCmd) ||
    />\s*[\w\.\/]/i.test(cleanCmd)
  ) {
    return {
      level: 'warning',
      label: '敏感写入指令',
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/15',
      borderColor: 'border-amber-500/40',
      description: '将修改项目依赖、写入文件或提交版本记录',
    };
  }

  // 只读安全指令
  return {
    level: 'safe',
    label: '只读/安全',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    description: '常规只读探查或安全构建指令',
  };
}
