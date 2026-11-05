#!/usr/bin/env node
/**
 * WinVibe 安全环境启动器
 * 清理系统环境变量中与 Node.js 24 / Electron 冲突的项 (NODE_OPTIONS, SOCKS5 PROXY)
 * 并自动解析本地安装的 electron.exe 绝对路径
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.HTTP_PROXY;
delete env.HTTPS_PROXY;
delete env.ALL_PROXY;

const args = process.argv.slice(2);
let command = args[0] || 'electron';
const commandArgs = args.slice(1);

// 如果是启动 electron，直接定位本地 node_modules 里的 electron 可执行文件
if (command === 'electron') {
  const localElectronExe = path.resolve(__dirname, '../node_modules/electron/dist/electron.exe');
  if (fs.existsSync(localElectronExe)) {
    command = localElectronExe;
  }
}

const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  shell: true,
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
