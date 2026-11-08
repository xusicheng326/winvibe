"""
WinVibe OASP (Open Agent Status Protocol) Python SDK
零外部依赖，使用 Python 标准库即可让任何自定义 Agent / 脚本一键入驻 Windows 灵动岛。
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any, List

class WinVibeClient:
    def __init__(self, agent_name: str = "Python Agent"):
        self.agent_name = agent_name
        self.port = 18989
        self.token = ""
        self.pid = os.getpid()
        self.session_id = f"py-{self.agent_name.replace(' ', '-').lower()}-{self.pid}"
        self._load_daemon_config()

    def _load_daemon_config(self) -> bool:
        daemon_file = Path.home() / ".winvibe" / "daemon.json"
        if daemon_file.exists():
            try:
                with open(daemon_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.port = data.get("port", 18989)
                    self.token = data.get("token", "")
                    return bool(self.token)
            except Exception:
                pass
        return False

    def _post(self, endpoint: str, payload: Dict[str, Any], timeout_s: float = 30.0) -> Optional[Dict[str, Any]]:
        if not self.token and not self._load_daemon_config():
            return None

        url = f"http://127.0.0.1:{self.port}{endpoint}"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            # 灵动岛未启动或请求超时，静默优雅降级
            return None
        return None

    def pulse(
        self,
        status: str = "running",
        message: str = "",
        cwd: Optional[str] = None,
        metrics: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        向灵动岛发送状态脉冲心跳
        :param status: 'running' | 'waiting' | 'completed' | 'error'
        :param message: 状态描述信息
        :param cwd: 工作目录路径
        :param metrics: 可选指标如 {'tokens': 1200, 'step': 3}
        """
        payload = {
            "session_id": self.session_id,
            "name": self.agent_name,
            "status": status,
            "message": message,
            "pid": self.pid,
            "cwd": cwd or os.getcwd(),
            "metrics": metrics,
        }
        res = self._post("/api/v1/agent/pulse", payload, timeout_s=3.0)
        return bool(res and res.get("acknowledged"))

    def request_approval(
        self,
        command: str,
        tool_name: str = "Bash",
        cwd: Optional[str] = None,
        timeout_s: float = 30.0,
    ) -> str:
        """
        在灵动岛上弹出阻塞审批卡片，等待用户放行或拒绝
        :return: 'allow' | 'deny' | 'ask'
        """
        payload = {
            "request_id": f"req-py-{int(time.time() * 1000)}",
            "session_id": self.session_id,
            "agent_name": self.agent_name,
            "tool_name": tool_name,
            "command": command,
            "cwd": cwd or os.getcwd(),
            "pid": self.pid,
            "timeout_ms": int(timeout_s * 1000),
        }
        res = self._post("/api/v1/decision/request", payload, timeout_s=timeout_s + 2.0)
        if res:
            return res.get("action", "allow")
        return "allow"

    def ask_question(
        self,
        question: str,
        options: Optional[List[str]] = None,
        timeout_s: float = 30.0,
    ) -> Optional[str]:
        """
        在灵动岛上弹出单选/多选题，等待用户点击选项答复
        :return: 用户点击或输入的选项文本
        """
        payload = {
            "request_id": f"req-q-{int(time.time() * 1000)}",
            "session_id": self.session_id,
            "agent_name": self.agent_name,
            "tool_name": "ask_question",
            "type": "question",
            "question": question,
            "options": options or ["确认", "取消"],
            "pid": self.pid,
            "timeout_ms": int(timeout_s * 1000),
        }
        res = self._post("/api/v1/decision/request", payload, timeout_s=timeout_s + 2.0)
        if res:
            return res.get("selected_option") or res.get("action")
        return None


if __name__ == "__main__":
    client = WinVibeClient("Demo Python Agent")
    print("[WinVibe Python SDK] 正在向灵动岛发送启动状态...")
    success = client.pulse(status="running", message="Demo Python Agent 已成功接入灵动岛！")
    if success:
        print("[WinVibe Python SDK] 心跳发送成功！灵动岛已同步状态。")
    else:
        print("[WinVibe Python SDK] 灵动岛未在后台运行，SDK 已自动优雅降级，未阻塞终端。")
