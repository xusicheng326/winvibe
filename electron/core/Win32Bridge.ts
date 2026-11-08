import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Win32Bridge {
  private static helperPath: string | null = null;

  public static getHelperExePath(): string {
    if (this.helperPath && fs.existsSync(this.helperPath)) {
      return this.helperPath;
    }

    const appPath = process.cwd();
    const resourcesPath = (process as any).resourcesPath || '';

    const candidates = [
      path.join(resourcesPath, 'scripts', 'WinVibeHelper.exe'),
      path.join(appPath, 'scripts', 'WinVibeHelper.exe'),
      path.join(__dirname, '../../scripts/WinVibeHelper.exe'),
      path.join(__dirname, '../scripts/WinVibeHelper.exe'),
      'D:\\vibe\\agent\\scripts\\WinVibeHelper.exe',
    ];

    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        this.helperPath = c;
        return c;
      }
    }

    return 'D:\\vibe\\agent\\scripts\\WinVibeHelper.exe';
  }

  public static focusWindow(pid?: number, nameHint?: string, cwdHint?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const helperExe = this.getHelperExePath();
      const targetPid = pid && pid > 0 ? String(pid) : '0';
      const args = ['focus', 'allow', targetPid];
      if (nameHint) args.push(nameHint);
      if (cwdHint) args.push(cwdHint);

      execFile(helperExe, args, (err, stdout) => {
        if (err) {
          console.warn(`[Win32Bridge] 唤醒窗口失败 (PID ${targetPid}):`, err.message);
          resolve(false);
        } else {
          console.log(`[Win32Bridge] 唤醒窗口响应 (PID ${targetPid}):`, stdout?.trim());
          resolve(true);
        }
      });
    });
  }

  public static sendConsoleKey(action: 'allow' | 'deny', pid?: number, nameHint?: string, cwdHint?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const helperExe = this.getHelperExePath();
      const targetPid = pid && pid > 0 ? String(pid) : '0';
      const args = ['send-key', action, targetPid];
      if (nameHint) args.push(nameHint);
      if (cwdHint) args.push(cwdHint);

      execFile(helperExe, args, (err, stdout) => {
        if (err) {
          console.warn(`[Win32Bridge] 发送控制台按键失败 (PID ${targetPid}):`, err.message);
          resolve(false);
        } else {
          console.log(`[Win32Bridge] 发送控制台按键成功:`, stdout?.trim());
          resolve(true);
        }
      });
    });
  }

  public static abortProcess(pid: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!pid || pid <= 0) return resolve(false);
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], (err) => {
        if (err) {
          console.warn(`[Win32Bridge] 终止进程失败 (PID ${pid}):`, err.message);
          resolve(false);
        } else {
          console.log(`[Win32Bridge] 成功终止失控任务进程 (PID ${pid})`);
          resolve(true);
        }
      });
    });
  }
}
