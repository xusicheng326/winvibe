#!/usr/bin/env node
/**
 * WinVibe Claude Code PreToolUse Hook
 * 读取 ~/.winvibe/daemon.json，携带鉴权向灵动岛发送审批请求并阻塞等待用户决策。
 * 超时或服务未启动时，快速降级为 ask 让终端接管。
 * 
 * 严格遵循 Claude Code 官方 Hook 规范：
 * 1. 诊断与过程日志全部输出至 stderr，严禁污染 stdout
 * 2. 决策完成后，在 stdout 输出合法的结构化 JSON 响应
 * 3. 退出码严格规范：allow 为 0，deny 为 2（阻断），ask 为 0（终端接管）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

// 仅向 stderr 打印日志，保证 stdout 纯净留给 Claude Code 的结构化 JSON 响应
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
        toolName = parsedPayload.tool_name || parsedPayload.toolName || 'Bash';
        cwd = parsedPayload.cwd || cwd;

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

  // 2. 兜底尝试从命令行参数读取（兼容 CLI 直接测试运行：node vibe-hook.js <cmd>）
  if (!commandToRun && process.argv.length > 2) {
    commandToRun = process.argv.slice(2).join(' ');
  }

  // 3. 最终默认值
  if (!commandToRun) {
    commandToRun = 'npm run build';
  }

  log(`拦截到工具执行: [${toolName}] "${commandToRun}" (cwd: ${cwd})`);
  log(`正在向 WinVibe 灵动岛提交审批并阻塞等待决策...`);

  const decision = await requestDecision({
    agent_name: 'Claude Code',
    tool_name: toolName,
    command: commandToRun,
    cwd: cwd,
    timeout_ms: 30000,
    pid: process.pid,
  });

  log(`决策结果:`, JSON.stringify(decision));

  // 4. 严格按照 Claude Code 官方规范输出 JSON 并退出
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
    // Claude Code 规范：退出码为 2 时代表拒绝并阻断该工具执行
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
  process.exit(0); // 避免由于 hook 内部异常崩溃而卡死 Claude
});
