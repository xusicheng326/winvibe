import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

export interface AuditRecord {
  id: string;
  agent_name: string;
  tool_name: string;
  command: string;
  cwd?: string;
  pid?: number;
  action: 'allow' | 'deny' | 'timeout' | 'ask';
  timestamp: number;
}

export class AuditService {
  private auditFilePath: string;
  private auditHistory: AuditRecord[] = [];
  private onUpdateCallback?: (records: AuditRecord[]) => void;

  constructor() {
    this.auditFilePath = path.join(os.homedir(), '.winvibe', 'audit_history.json');
    this.load();
  }

  public setOnUpdate(cb: (records: AuditRecord[]) => void) {
    this.onUpdateCallback = cb;
  }

  public getHistory(): AuditRecord[] {
    return [...this.auditHistory];
  }

  public addRecord(record: AuditRecord): void {
    this.auditHistory.unshift(record);
    if (this.auditHistory.length > 100) {
      this.auditHistory = this.auditHistory.slice(0, 100);
    }
    this.save();
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.getHistory());
    }
  }

  public clearHistory(): void {
    this.auditHistory = [];
    this.save();
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.getHistory());
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.auditFilePath)) {
        const data = fs.readFileSync(this.auditFilePath, 'utf-8');
        this.auditHistory = JSON.parse(data);
      }
    } catch {
      this.auditHistory = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.auditFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.auditFilePath, JSON.stringify(this.auditHistory, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[AuditService] 保存审计记录失败:', err);
    }
  }
}
