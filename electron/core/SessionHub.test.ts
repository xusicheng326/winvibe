import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub } from './SessionHub.js';

test('SessionHub - 多终端独立会话与状态机隔离', () => {
  const hub = new SessionHub();

  // 模拟两个同类会话 (不同 PID 与目录)
  hub.upsertSession({
    id: 'claude-1001',
    sessionId: 'claude-1001',
    name: 'Claude Code (frontend)',
    status: 'running',
    pid: 1001,
    cwd: 'D:\\project\\frontend',
  });

  hub.upsertSession({
    id: 'claude-1002',
    sessionId: 'claude-1002',
    name: 'Claude Code (backend)',
    status: 'waiting',
    pid: 1002,
    cwd: 'D:\\project\\backend',
  });

  assert.equal(hub.getAllSessions().length, 2);

  // 会话 1 完成，会话 2 仍保持 waiting
  hub.upsertSession({
    id: 'claude-1001',
    status: 'completed',
  });

  assert.equal(hub.getSession('claude-1001')?.status, 'completed');
  assert.equal(hub.getSession('claude-1002')?.status, 'waiting');
});

test('SessionHub - FIFO 审批队列与指定目标消费', () => {
  const hub = new SessionHub();
  let action1 = '';
  let action2 = '';

  hub.enqueueDecision(
    {
      request_id: 'req-alpha',
      session_id: 'claude-1001',
      agent_name: 'Claude Code',
      tool_name: 'Bash',
      command: 'npm run test',
      timestamp: Date.now(),
    },
    (act) => {
      action1 = act;
    }
  );

  hub.enqueueDecision(
    {
      request_id: 'req-beta',
      session_id: 'claude-1002',
      agent_name: 'Claude Code',
      tool_name: 'Bash',
      command: 'git status',
      timestamp: Date.now(),
    },
    (act) => {
      action2 = act;
    }
  );

  assert.equal(hub.getDecisionQueue().length, 2);

  // 1. 默认消费队首 req-alpha
  const first = hub.resolveTargetOrHead('allow');
  assert.equal(first.handled, true);
  assert.equal(first.requestId, 'req-alpha');
  assert.equal(action1, 'allow');
  assert.equal(hub.getDecisionQueue().length, 1);

  // 2. 消费下一个 req-beta
  const second = hub.resolveTargetOrHead('deny');
  assert.equal(second.handled, true);
  assert.equal(second.requestId, 'req-beta');
  assert.equal(action2, 'deny');
  assert.equal(hub.getDecisionQueue().length, 0);
});
