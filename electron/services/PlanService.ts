import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

export interface ActivePlan {
  title: string;
  path: string;
  content: string;
  totalTasks: number;
  completedTasks: number;
  lastUpdated: number;
}

export class PlanService {
  public static getActivePlan(): ActivePlan | null {
    try {
      const candidatePaths: string[] = [
        path.join(process.cwd(), 'VIBE_ISLAND_UPGRADE_PLAN.md'),
        'D:\\vibe\\agent\\VIBE_ISLAND_UPGRADE_PLAN.md',
        path.join(process.cwd(), 'PROJECT_PLAN.md'),
        'D:\\vibe\\agent\\PROJECT_PLAN.md',
      ];

      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
      if (fs.existsSync(brainDir)) {
        const dirs = fs.readdirSync(brainDir)
          .map(d => {
            try {
              const p = path.join(brainDir, d);
              return { dir: p, mtime: fs.statSync(p).mtimeMs };
            } catch {
              return null;
            }
          })
          .filter((d): d is { dir: string; mtime: number } => d !== null)
          .sort((a, b) => b.mtime - a.mtime);

        for (const item of dirs.slice(0, 3)) {
          try {
            const files = fs.readdirSync(item.dir);
            const planFile = files.find(f => (f.endsWith('_plan.md') || f === 'PROJECT_PLAN.md') && !f.endsWith('.metadata.json'));
            if (planFile) {
              candidatePaths.unshift(path.join(item.dir, planFile));
            }
          } catch {}
        }
      }

      for (const planPath of candidatePaths) {
        if (fs.existsSync(planPath)) {
          const content = fs.readFileSync(planPath, 'utf-8');
          const lines = content.split('\n');

          const titleLine = lines.find(l => l.startsWith('# '));
          const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : path.basename(planPath);

          let totalTasks = 0;
          let completedTasks = 0;

          for (const line of lines) {
            if (/^\s*-\s*\[\s*\]/.test(line)) totalTasks++;
            else if (/^\s*-\s*\[[xX]\]/.test(line)) {
              totalTasks++;
              completedTasks++;
            }
          }

          const stat = fs.statSync(planPath);
          return {
            title,
            path: planPath,
            content,
            totalTasks,
            completedTasks,
            lastUpdated: stat.mtimeMs,
          };
        }
      }
    } catch (e) {
      console.warn('[PlanService] 读取计划文件异常:', e);
    }
    return null;
  }
}
