#!/usr/bin/env node
/**
 * WinVibe Claude Code Lifecycle & PreToolUse Hook
 * 1. 拦截 PreToolUse: 向灵动岛发送带 session_id / pid 的审批请求并阻塞等待用户决策。
 * 2. 监听 UserPromptSubmit / Stop 等生命周期事件: 向 /api/v1/session/event 发送非阻塞状态更新。
 * 
 * 严格遵循 Claude Code 官方 Hook 规范：
 * - 诊断与过程日志全部输出至 stderr，严禁污染 stdout
 * - PreToolUse 决策完成后，在 stdout 输出合法的结构化 JSON 响应
 * - 退出码严格规范：allow 为 0，deny 为 2（阻断），ask 为 0（终端接管），生命周期通知为 0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

function log(...args) {
  process.stderr.write(`[vibe-hook] ${args.join(' ')}\n`);
}

function getDaemonConfig() {
  const daemonPath = path.join(os.homedir(), '.winvibe', 'daemon.json');
  if (!fs.existsSync(daemonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(daemonPath, 'utf-8'));
  } catch {
    return null;
  }
}

// 非阻塞生命周期状态事件上报 (UserPromptSubmit, Stop, etc.)
async function sendSessionEvent(payload) {
  const daemon = getDaemonConfig();
  if (!daemon || !daemon.port || !daemon.token) {
    log('WinVibe 守护进程未启动，跳过生命周期事件上报');
    return null;
  }

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: daemon.port,
        path: '/api/v1/session/event',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${daemon.token}`,
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 4000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ status: 'ok' });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.on('error', (err) => {
      log(`发送 session 事件异常: ${err.message}`);
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

// 阻塞式审批决策请求 (PreToolUse)
async function requestDecision(payload) {
  const daemon = getDaemonConfig();
  if (!daemon || !daemon.port || !daemon.token) {
    log('WinVibe 守护进程未启动，自动降级为终端原生确认 (ask)');
    return { action: 'ask', reason: 'daemon_not_running' };
  }

  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: daemon.port,
        path: '/api/v1/decision/request',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${daemon.token}`,
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: (payload.timeout_ms || 30000) + 1000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            log('解析灵动岛响应失败，降级为 ask');
            resolve({ action: 'ask', reason: 'invalid_response' });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      log('灵动岛等待审批超时 (30s)，降级为终端原生确认 (ask)');
      resolve({ action: 'ask', reason: 'timeout' });
    });

    req.on('error', (err) => {
      log(`与 WinVibe 连接异常: ${err.message}，降级为 ask`);
      resolve({ action: 'ask', reason: 'connection_error' });
    });

    req.write(postData);
    req.end();
  });
}

async function main() {
  let commandToRun = '';
  let toolName = 'Bash';
  let cwd = process.cwd();
  let sessionId = '';
  let hookEventName = '';
  let parsedPayload = null;

  // 1. 优先尝试从 stdin 读取 Claude Code 传入的完整上下文 JSON
  if (!process.stdin.isTTY) {
    try {
      const stdinChunks = [];
      for await (const chunk of process.stdin) {
        stdinChunks.push(chunk);
      }
      const raw = Buffer.concat(stdinChunks).toString('utf-8').trim();
      if (raw) {
        parsedPayload = JSON.parse(raw);
        sessionId = parsedPayload.session_id || parsedPayload.sessionId || '';
        cwd = parsedPayload.cwd || cwd;
        hookEventName = parsedPayload.hook_event_name || parsedPayload.hookEventName || '';
        toolName = parsedPayload.tool_name || parsedPayload.toolName || toolName;

        // 兼容 snake_case 与 camelCase 的命令与参数解析
        const toolInput = parsedPayload.tool_input || parsedPayload.toolInput || {};
        if (typeof toolInput.command === 'string') {
          commandToRun = toolInput.command;
        } else if (typeof toolInput.file_path === 'string') {
          commandToRun = `${toolName} ${toolInput.file_path}`;
        } else if (typeof parsedPayload.command === 'string') {
          commandToRun = parsedPayload.command;
        }
      }
    } catch (err) {
      log('读取 stdin 异常:', err.message);
    }
  }

  // 2. 兜底从命令行参数获取事件名或测试指令（兼容 CLI 调试：node vibe-hook.js UserPromptSubmit）
  if (!hookEventName && process.argv.length > 2) {
    const firstArg = process.argv[2];
    if (['UserPromptSubmit', 'Stop', 'PreToolUse'].includes(firstArg)) {
      hookEventName = firstArg;
    } else {
      commandToRun = process.argv.slice(2).join(' ');
    }
  }

  if (!hookEventName) {
    hookEventName = 'PreToolUse';
  }

  // 父 PID 即为调用本 hook 的 Claude Code 终端 CLI 进程 PID
  const parentPid = process.ppid || process.pid;

  // 3. 处理生命周期非阻塞通知 (UserPromptSubmit, Stop, etc.)
  if (hookEventName !== 'PreToolUse') {
    log(`收到生命周期事件: [${hookEventName}] (sessionId: ${sessionId || '未提供'}, ppid: ${parentPid})`);
    await sendSessionEvent({
      agent: 'Claude Code',
      session_id: sessionId || `claude-${parentPid}`,
      event_name: hookEventName,
      cwd,
      pid: parentPid,
      tool_name: toolName,
    });
    process.exit(0);
  }

  // 4. 处理 PreToolUse 阻塞式决策审批
  if (!commandToRun) {
    commandToRun = 'npm run build';
  }

  log(`拦截到工具执行: [${toolName}] "${commandToRun}" (cwd: ${cwd}, session_id: ${sessionId}, ppid: ${parentPid})`);
  log(`正在向 WinVibe 灵动岛提交审批并阻塞等待决策...`);

  const decision = await requestDecision({
    agent_name: 'Claude Code',
    tool_name: toolName,
    command: commandToRun,
    cwd,
    session_id: sessionId || `claude-${parentPid}`,
    hook_event_name: 'PreToolUse',
    timeout_ms: 30000,
    pid: parentPid,
    parent_pid: parentPid,
  });

  log(`决策结果:`, JSON.stringify(decision));

  // 5. 严格按照 Claude Code 官方规范输出 JSON 并退出
  if (decision.action === 'allow') {
    log('✅ 决策通过：允许执行');
    const responseJson = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    };
    process.stdout.write(JSON.stringify(responseJson) + '\n');
    process.exit(0);
  } else if (decision.action === 'deny') {
    log('❌ 决策阻断：拒绝执行');
    const responseJson = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Command blocked by user via WinVibe Island.',
      },
    };
    process.stdout.write(JSON.stringify(responseJson) + '\n');
    process.exit(2);
  } else {
    log('⚠️ 降级回退：交由终端原生提示 (ask)');
    const responseJson = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
      },
    };
    process.stdout.write(JSON.stringify(responseJson) + '\n');
    process.exit(0);
  }
}

main().catch((err) => {
  log('Hook 致命异常:', err.message);
  process.exit(0);
});
