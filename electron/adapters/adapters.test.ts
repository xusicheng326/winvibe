import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionHub } from '../core/SessionHub.js';
import { AntigravityAdapter } from './AntigravityAdapter.js';
import { OpenCodeAdapter } from './OpenCodeAdapter.js';

test('AntigravityAdapter - GENERIC 工具返回事件绝不落入空闲状态', async () => {
  const hub = new SessionHub();
  const adapter = new AntigravityAdapter(hub);

  // 模拟脑图目录与日志文件
  const testDir = path.join(os.tmpdir(), `agy-test-${Date.now()}`);
  const logDir = path.join(testDir, 'test-sess', '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'transcript.jsonl');

  (adapter as any).brainDir = testDir;

  // 1. 模拟写入 USER_INPUT
  fs.writeFileSync(logFile, JSON.stringify({
    step_index: 1,
    type: 'USER_INPUT',
    content: '请帮我写一个测试脚本'
  }) + '\n');
  adapter.scanAndSync();
  let session = hub.getAllSessions().find(s => s.agentType === 'antigravity');
  assert.equal(session?.status, 'running', 'USER_INPUT 应为 running');

  // 2. 模拟工具调用 (PLANNER_RESPONSE 带 read_file)
  fs.appendFileSync(logFile, JSON.stringify({
    step_index: 2,
    type: 'PLANNER_RESPONSE',
    tool_calls: [{ name: 'read_file', arguments: { Path: 'C:/test/file.ts' } }]
  }) + '\n');
  adapter.scanAndSync();
  session = hub.getAllSessions().find(s => s.agentType === 'antigravity');
  assert.equal(session?.status, 'running', '调用 read_file 应为 running');

  // 3. 模拟工具返回结果 GENERIC (核心修复点！)
  fs.appendFileSync(logFile, JSON.stringify({
    step_index: 3,
    type: 'GENERIC',
    content: 'Showing lines 1-50 of file.ts...'
  }) + '\n');
  adapter.scanAndSync();
  session = hub.getAllSessions().find(s => s.agentType === 'antigravity');
  assert.equal(session?.status, 'running', '工具结果返回 (GENERIC) 必须保持 running，绝不可误判为 completed');
  assert.match(session?.lastMessage || '', /已获取执行结果/, '消息应表明正在消化工具结果');

  // 4. 模拟最终无工具回复 (PLANNER_RESPONSE 无 tool_calls)
  fs.appendFileSync(logFile, JSON.stringify({
    step_index: 4,
    type: 'PLANNER_RESPONSE',
    content: '测试脚本已为您编写完成。',
    tool_calls: []
  }) + '\n');
  adapter.scanAndSync();
  session = hub.getAllSessions().find(s => s.agentType === 'antigravity');
  assert.equal(session?.status, 'completed', '无后续工具调用的 PLANNER_RESPONSE 应标记为 completed');

  // 清理临时文件
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('OpenCodeAdapter - 倒序事件状态机精准识别完成与目录感知', async () => {
  const hub = new SessionHub();
  const adapter = new OpenCodeAdapter(hub);

  const testDir = path.join(os.tmpdir(), `opencode-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  const logFile = path.join(testDir, 'opencode.log');

  (adapter as any).logPath = logFile;
  (adapter as any).dbPath = path.join(testDir, 'opencode.db'); // 不存在时优雅降级

  // 模拟启动阶段带有非致命错误（如 models.dev 告警）与流式生成
  const logs = [
    'timestamp=2026-11-09T14:09:03.062Z level=INFO run=123 message="creating instance" directory="C:\\\\Users\\\\xyc\\\\my-app"',
    'timestamp=2026-11-09T14:09:04.830Z level=ERROR run=123 message="Failed to fetch models.dev" cause="UnsupportedProxyProtocol"',
    'timestamp=2026-11-09T14:09:15.531Z level=INFO run=123 message=created id=ses_test123 slug=stellar-knight directory="C:\\\\Users\\\\xyc\\\\my-app" model.id=qwen2.5',
    'timestamp=2026-11-09T14:09:17.149Z level=INFO run=123 message=stream providerID=ollama session.id=ses_test123',
  ];
  fs.writeFileSync(logFile, logs.join('\n') + '\n');

  adapter.checkStatus();
  let session = hub.getAllSessions().find(s => s.agentType === 'opencode');
  assert.ok(session, '应该识别出 opencode 会话');
  assert.equal(session?.status, 'running', '流式生成中应为 running，即使前文存在非致命 ERROR');
  assert.equal(session?.name, 'OpenCode (my-app)', '应准确提取工作区目录 my-app');

  // 模拟输出 exiting loop 结束回合
  fs.appendFileSync(logFile, 'timestamp=2026-11-09T14:09:26.901Z level=INFO run=123 message="exiting loop" session.id=ses_test123\n');
  adapter.checkStatus();
  session = hub.getAllSessions().find(s => s.agentType === 'opencode');
  assert.equal(session?.status, 'running', '刚结束时进入状态阻尼保护窗口 (1.5s)，防止本地极速模型闪退导致状态不可见');

  // 等待阻尼窗口到期后平滑转为 completed
  await new Promise(r => setTimeout(r, 1600));
  session = hub.getAllSessions().find(s => s.agentType === 'opencode');
  assert.equal(session?.status, 'completed', '阻尼期结束后状态平滑转为 completed (就绪待命)');

  // 清理临时文件
  await adapter.destroy();
  fs.rmSync(testDir, { recursive: true, force: true });
});
