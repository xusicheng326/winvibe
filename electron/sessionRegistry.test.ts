import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRegistry } from './sessionRegistry.js';

test('SessionRegistry - 同一 agent 两个会话互不影响', () => {
  const registry = new SessionRegistry();

  // 模拟同一个 agent (Google Antigravity) 的两个独立终端会话
  registry.upsert({
    sessionId: 'session-agy-1',
    agent: 'Google Antigravity',
    pid: 1001,
    cwd: 'D:\\project1',
    status: 'running',
    source: 'log',
  });

  registry.upsert({
    sessionId: 'session-agy-2',
    agent: 'Google Antigravity',
    pid: 1002,
    cwd: 'D:\\project2',
    status: 'waiting',
    source: 'log',
    pendingRequestId: 'req-ask-1',
  });

  const s1 = registry.get('session-agy-1');
  const s2 = registry.get('session-agy-2');

  assert.ok(s1, 'session 1 应该存在');
  assert.ok(s2, 'session 2 应该存在');
  assert.equal(s1.agent, 'Google Antigravity');
  assert.equal(s2.agent, 'Google Antigravity');
  assert.equal(s1.pid, 1001);
  assert.equal(s2.pid, 1002);
  assert.equal(s1.status, 'running');
  assert.equal(s2.status, 'waiting');
  assert.equal(s1.pendingRequestId, undefined);
  assert.equal(s2.pendingRequestId, 'req-ask-1');

  // 修改会话 1 的状态，会话 2 状态绝不受影响
  registry.upsert({
    sessionId: 'session-agy-1',
    status: 'completed',
  });

  assert.equal(registry.get('session-agy-1')?.status, 'completed');
  assert.equal(registry.get('session-agy-2')?.status, 'waiting');

  const all = registry.list();
  assert.equal(all.length, 2, '应该包含两个独立会话，而不是按 agent 聚合为 1 个');
});

test('SessionRegistry - upsert 合并字段', () => {
  const registry = new SessionRegistry();

  // 1. 初次插入基础信息
  const initial = registry.upsert({
    sessionId: 'claude-sess-1',
    agent: 'Claude Code',
    pid: 2001,
    status: 'running',
    source: 'process',
  });

  assert.equal(initial.sessionId, 'claude-sess-1');
  assert.equal(initial.agent, 'Claude Code');
  assert.equal(initial.pid, 2001);
  assert.equal(initial.status, 'running');
  assert.equal(initial.source, 'process');
  assert.ok(initial.updatedAt > 0);

  // 2. 增量更新部分字段（如从 hook 上报工作目录和审批请求），其余字段应被完整保留
  const updated = registry.upsert({
    sessionId: 'claude-sess-1',
    cwd: 'D:\\workspace\\demo',
    status: 'waiting',
    pendingRequestId: 'req-claude-99',
    source: 'hook',
  });

  assert.equal(updated.sessionId, 'claude-sess-1');
  assert.equal(updated.agent, 'Claude Code', '原有 agent 字段应被保留');
  assert.equal(updated.pid, 2001, '原有 pid 字段应被保留');
  assert.equal(updated.cwd, 'D:\\workspace\\demo', '增量更新的 cwd 应生效');
  assert.equal(updated.status, 'waiting', '增量更新的 status 应生效');
  assert.equal(updated.source, 'hook', '增量更新的 source 应生效');
  assert.equal(updated.pendingRequestId, 'req-claude-99');
});

test('SessionRegistry - markDeadByPid 清理', () => {
  const registry = new SessionRegistry();

  registry.upsert({ sessionId: 's-1', agent: 'AgentA', pid: 111, status: 'running' });
  registry.upsert({ sessionId: 's-2', agent: 'AgentB', pid: 222, status: 'running' });
  registry.upsert({ sessionId: 's-3', agent: 'AgentC', pid: 333, status: 'running' });
  registry.upsert({ sessionId: 's-4', agent: 'AgentD', status: 'unknown' }); // 无 pid 的会话

  assert.equal(registry.list().length, 4);

  // 假设进程扫描结果：只有 PID 222 还活着
  registry.markDeadByPid([222]);

  const remaining = registry.list();
  assert.equal(remaining.length, 2, 'PID 为 111 与 333 的会话应被清理，无 PID 的会话与 222 应保留');
  assert.ok(registry.get('s-2'), 'PID 222 的会话应保留');
  assert.ok(registry.get('s-4'), '未绑定 PID 的会话不应被误删');
  assert.equal(registry.get('s-1'), undefined, 'PID 111 应已被清理');
  assert.equal(registry.get('s-3'), undefined, 'PID 333 应已被清理');

  // 支持传入 Set
  registry.markDeadByPid(new Set<number>());
  assert.equal(registry.get('s-2'), undefined, 'PID 222 不在空 Set 中应被清理');
  assert.equal(registry.list().length, 1);
  assert.ok(registry.get('s-4'));
});

test('SessionRegistry - onChange 监听与注销', () => {
  const registry = new SessionRegistry();
  let callCount = 0;
  let lastSessions: any[] = [];

  const unbind = registry.onChange((sessions) => {
    callCount++;
    lastSessions = sessions;
  });

  registry.upsert({ sessionId: 'test-1', agent: 'TestAgent' });
  assert.equal(callCount, 1);
  assert.equal(lastSessions.length, 1);

  registry.remove('test-1');
  assert.equal(callCount, 2);
  assert.equal(lastSessions.length, 0);

  // 注销监听后不应再触发
  unbind();
  registry.upsert({ sessionId: 'test-2', agent: 'TestAgent' });
  assert.equal(callCount, 2, '注销后 callCount 不应再增加');
});
