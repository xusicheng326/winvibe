using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;
using System.IO;

namespace WinVibe {
    public class Program {
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

        [DllImport("user32.dll")]
        public static extern bool LockSetForegroundWindow(uint uLockCode);

        [DllImport("user32.dll")]
        public static extern bool AllowSetForegroundWindow(int dwProcessId);

        [DllImport("user32.dll", EntryPoint = "SystemParametersInfo")]
        public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        private const uint SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;
        private const uint LSFW_UNLOCK = 2;
        private const int ASFW_ANY = -1;

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        // Toolhelp32 for process parent lookup
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        public struct PROCESSENTRY32 {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        // Console APIs
        private const int STD_INPUT_HANDLE = -10;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern IntPtr CreateFile(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            IntPtr lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AttachConsole(uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool FreeConsole();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();

        [StructLayout(LayoutKind.Explicit)]
        public struct INPUT_RECORD {
            [FieldOffset(0)]
            public ushort EventType; // 1 = KEY_EVENT
            [FieldOffset(4)]
            public int bKeyDown;
            [FieldOffset(8)]
            public ushort wRepeatCount;
            [FieldOffset(10)]
            public ushort wVirtualKeyCode;
            [FieldOffset(12)]
            public ushort wVirtualScanCode;
            [FieldOffset(14)]
            public char UnicodeChar;
            [FieldOffset(16)]
            public uint dwControlKeyState;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool WriteConsoleInput(
            IntPtr hConsoleInput,
            INPUT_RECORD[] lpBuffer,
            uint nLength,
            out uint lpNumberOfEventsWritten
        );

        public static uint GetParentProcessId(uint pid) {
            uint parentPid = 0;
            IntPtr hSnapshot = CreateToolhelp32Snapshot(0x00000002, 0); // TH32CS_SNAPPROCESS
            if (hSnapshot != IntPtr.Zero && hSnapshot != new IntPtr(-1)) {
                PROCESSENTRY32 pe = new PROCESSENTRY32();
                pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Process32First(hSnapshot, ref pe)) {
                    do {
                        if (pe.th32ProcessID == pid) {
                            parentPid = pe.th32ParentProcessID;
                            break;
                        }
                    } while (Process32Next(hSnapshot, ref pe));
                }
                CloseHandle(hSnapshot);
            }
            return parentPid;
        }

        public static void ForceForeground(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return;

            IntPtr fgWnd = GetForegroundWindow();
            if (fgWnd == hWnd) {
                // 已经在前台，无需重新激活，避免闪屏
                return;
            }

            // 1. 突破 Windows 系统前台锁定限制 (Foreground Lockout Bypass)
            try {
                LockSetForegroundWindow(LSFW_UNLOCK);
                SystemParametersInfo(SPI_SETFOREGROUNDLOCKTIMEOUT, 0, IntPtr.Zero, 0x0002 | 0x0001);
                AllowSetForegroundWindow(ASFW_ANY);
            } catch {}

            // 2. 模拟 Alt 键释放，强力破除 Windows 焦点保护
            keybd_event(0x12, 0, 0, UIntPtr.Zero); // VK_MENU down
            keybd_event(0x12, 0, 2, UIntPtr.Zero); // VK_MENU up

            uint dummyPid;
            uint fgThread = fgWnd != IntPtr.Zero ? GetWindowThreadProcessId(fgWnd, out dummyPid) : 0;
            uint curThread = GetCurrentThreadId();
            uint targetThread = GetWindowThreadProcessId(hWnd, out dummyPid);

            if (fgThread != 0 && fgThread != targetThread) {
                AttachThreadInput(fgThread, targetThread, true);
            }
            if (curThread != 0 && curThread != targetThread) {
                AttachThreadInput(curThread, targetThread, true);
            }

            // 3. 恢复最小化窗口或显示窗口
            if (IsIconic(hWnd)) {
                ShowWindow(hWnd, 9); // SW_RESTORE
            } else {
                ShowWindow(hWnd, 5); // SW_SHOW
            }

            // 突破 DWM Z-Order 层级锁 (Topmost Pulse)
            SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002);
            SetWindowPos(hWnd, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002);

            // 4. Windows 官方 Alt+Tab 切换专有 API
            SwitchToThisWindow(hWnd, true);
            SetForegroundWindow(hWnd);
            BringWindowToTop(hWnd);

            if (fgThread != 0 && fgThread != targetThread) {
                AttachThreadInput(fgThread, targetThread, false);
            }
            if (curThread != 0 && curThread != targetThread) {
                AttachThreadInput(curThread, targetThread, false);
            }
        }

        public static bool InjectKeyToConsoleBuffer(uint pid, char c) {
            FreeConsole();
            if (!AttachConsole(pid)) return false;

            // 必须以 GENERIC_READ | GENERIC_WRITE (0xC0000000) 权限打开 CONIN$，GetStdHandle(-10) 默认无写入权限
            IntPtr hIn = CreateFile("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (hIn == IntPtr.Zero || hIn == new IntPtr(-1)) {
                hIn = GetStdHandle(STD_INPUT_HANDLE);
            }
            if (hIn == IntPtr.Zero || hIn == new IntPtr(-1)) {
                FreeConsole();
                return false;
            }

            var list = new List<INPUT_RECORD>();
            char[] chars = new char[] { c, '\r' };
            foreach (char ch in chars) {
                ushort vk = (ushort)ch;
                ushort scan = 0;
                if (ch == '\r') { vk = 0x0D; scan = 0x1C; }
                else if (ch == 'y' || ch == 'Y') { vk = 0x59; scan = 0x15; }
                else if (ch == 'n' || ch == 'N') { vk = 0x4E; scan = 0x31; }
                else if (ch >= '0' && ch <= '9') { vk = (ushort)(0x30 + (ch - '0')); scan = (ushort)(0x02 + (ch - '1')); }

                INPUT_RECORD kd = new INPUT_RECORD();
                kd.EventType = 1;
                kd.bKeyDown = 1;
                kd.wRepeatCount = 1;
                kd.wVirtualKeyCode = vk;
                kd.wVirtualScanCode = scan;
                kd.UnicodeChar = ch;
                kd.dwControlKeyState = 0;
                list.Add(kd);

                INPUT_RECORD ku = new INPUT_RECORD();
                ku.EventType = 1;
                ku.bKeyDown = 0;
                ku.wRepeatCount = 1;
                ku.wVirtualKeyCode = vk;
                ku.wVirtualScanCode = scan;
                ku.UnicodeChar = ch;
                ku.dwControlKeyState = 0;
                list.Add(ku);
            }

            uint written = 0;
            bool ok = WriteConsoleInput(hIn, list.ToArray(), (uint)list.Count, out written);
            CloseHandle(hIn);
            FreeConsole();
            return ok && written > 0;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        private const uint WM_CHAR = 0x0102;
        private const uint WM_KEYDOWN = 0x0100;
        private const uint WM_KEYUP = 0x0101;

        public static void PostKeyToWindow(IntPtr hWnd, char c) {
            if (hWnd == IntPtr.Zero) return;
            // 通过定向 Win32 消息队列投递字符与回车，100% 免疫物理 Alt 修饰键干扰，绝不触发全屏或退出
            PostMessage(hWnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
            Thread.Sleep(20);
            PostMessage(hWnd, WM_CHAR, (IntPtr)'\r', IntPtr.Zero);
        }

        public static void SimulateKeyboard(char c) {
            // 关键修复：当用户按下 Alt+Y 时，物理 Alt 键（VK_MENU = 0x12）可能仍处于按下状态。
            // 如果此时直接发送回车（0x0D），系统会识别为 Alt+Enter（Windows 终端全屏切换快捷键），导致剧烈放大缩小和闪屏！
            // 因此必须先显式释放 Alt 键！
            keybd_event(0x12, 0x38, 2, UIntPtr.Zero); // VK_MENU UP
            keybd_event(0xA4, 0x38, 2, UIntPtr.Zero); // VK_LMENU UP
            keybd_event(0xA5, 0x38, 2, UIntPtr.Zero); // VK_RMENU UP
            Thread.Sleep(20);

            byte vk = (byte)c;
            byte scan = 0;
            if (c == 'y' || c == 'Y') { vk = 0x59; scan = 0x15; }
            else if (c == 'n' || c == 'N') { vk = 0x4E; scan = 0x31; }
            else if (c >= '0' && c <= '9') { vk = (byte)(0x30 + (c - '0')); scan = (byte)(0x02 + (c - '1')); }

            // Key press
            keybd_event(vk, scan, 0, UIntPtr.Zero);
            keybd_event(vk, scan, 2, UIntPtr.Zero);

            Thread.Sleep(30);

            // 再次确保 Alt 键未按下，然后发送 Enter
            keybd_event(0x12, 0x38, 2, UIntPtr.Zero);
            keybd_event(0x0D, 0x1C, 0, UIntPtr.Zero);
            keybd_event(0x0D, 0x1C, 2, UIntPtr.Zero);
        }

        public static bool IsTerminalProcess(string procName) {
            if (string.IsNullOrEmpty(procName)) return false;
            procName = procName.ToLowerInvariant();
            return procName.Contains("cmd") ||
                   procName.Contains("powershell") ||
                   procName.Contains("pwsh") ||
                   procName.Contains("windowsterminal") ||
                   procName.Contains("wt") ||
                   procName.Contains("openconsole") ||
                   procName.Contains("conhost") ||
                   procName.Contains("mintty") ||
                   procName.Contains("bash") ||
                   procName.Contains("code") ||
                   procName.Contains("cursor") ||
                   procName.Contains("node") ||
                   procName.Contains("alacritty") ||
                   procName.Contains("wezterm") ||
                   procName.Contains("tabby") ||
                   procName.Contains("idea64") ||
                   procName.Contains("agy") ||
                   procName.Contains("antigravity") ||
                   procName.Contains("opencode") ||
                   procName.Contains("hermes") ||
                   procName.Contains("claude");
        }

        public static void Log(string msg) {
            try {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".winvibe");
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "bridge.log"), "[" + DateTime.Now.ToString("HH:mm:ss.fff") + "] [Helper] " + msg + "\r\n");
            } catch {}
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenWindowStation(string name, bool inherit, uint access);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessWindowStation(IntPtr hWinStation);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenDesktop(string name, uint flags, bool inherit, uint access);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll")]
        public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpEnumFunc, IntPtr lParam);

        public static void EnsureInteractiveDesktop() {
            try {
                IntPtr hWinsta = OpenWindowStation("winsta0", false, 0x037F);
                if (hWinsta != IntPtr.Zero) {
                    SetProcessWindowStation(hWinsta);
                }
                IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero) {
                    SetThreadDesktop(hDesk);
                }
            } catch {}
        }

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
        private const uint GA_ROOT = 2;

        public static IntPtr FindWindowForAgent(uint pid, string nameHint, string cwdHint) {
            IntPtr hWinsta = OpenWindowStation("winsta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);

            string hint = !string.IsNullOrEmpty(nameHint) ? nameHint.ToLowerInvariant() : "";
            string cwd = !string.IsNullOrEmpty(cwdHint) ? cwdHint.ToLowerInvariant() : "";

            // 1. 核心黄金法则: 原生控制台窗口直连 (AttachConsole -> GetConsoleWindow)
            // 解决纯控制台进程 (如 agy.exe、opencode.exe) 本身没有独立顶层窗口的问题，直接获取真实的宿主终端窗口
            if (pid > 0) {
                try {
                    FreeConsole();
                    if (AttachConsole(pid)) {
                        IntPtr hConsole = GetConsoleWindow();
                        FreeConsole();
                        if (hConsole != IntPtr.Zero && IsWindowVisible(hConsole)) {
                            IntPtr hRoot = GetAncestor(hConsole, GA_ROOT);
                            IntPtr targetConsoleWnd = (hRoot != IntPtr.Zero && IsWindowVisible(hRoot)) ? hRoot : hConsole;
                            Log("Direct console window matched via AttachConsole for PID " + pid + ": HWND=" + targetConsoleWnd);
                            return targetConsoleWnd;
                        }
                    }
                } catch (Exception ex) {
                    Log("AttachConsole probe error: " + ex.Message);
                }
            }

            // 2. 进程树溯源：收集目标进程及其父进程、祖父进程 PID 家族
            HashSet<uint> familyPids = new HashSet<uint>();
            if (pid > 0) {
                familyPids.Add(pid);
                uint cur = pid;
                for (int depth = 0; depth < 3; depth++) {
                    uint p = GetParentProcessId(cur);
                    if (p > 0 && !familyPids.Contains(p)) {
                        familyPids.Add(p);
                        cur = p;
                    } else {
                        break;
                    }
                }
            }

            IntPtr bestWnd = IntPtr.Zero;
            int bestScore = 0;
            string bestInfo = "";

            EnumDesktopWindows(hDesk, (hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    StringBuilder sbT = new StringBuilder(512);
                    StringBuilder sbC = new StringBuilder(512);
                    GetWindowText(hWnd, sbT, 512);
                    GetClassName(hWnd, sbC, 512);
                    uint pId;
                    GetWindowThreadProcessId(hWnd, out pId);
                    string title = sbT.ToString();
                    string titleLower = title.ToLowerInvariant();
                    string cls = sbC.ToString();
                    string proc = "";
                    try { proc = Process.GetProcessById((int)pId).ProcessName.ToLowerInvariant(); } catch {}

                    // 排除系统外壳、桌面背景与任务栏
                    if (proc == "explorer" || proc == "system" || cls == "Progman" || cls == "Shell_TrayWnd") {
                        if (!hint.Contains("winvibe")) return true;
                    }

                    // 特殊情况：如果明确唤醒 WinVibe
                    if (hint.Contains("winvibe") && proc.Contains("winvibe")) {
                        bestWnd = hWnd;
                        bestScore = 9999;
                        return false;
                    }

                    if (proc == "winvibe") return true;

                    int score = 0;

                    // 1. 终端与代码宿主特征评分
                    bool isTerminalHost = proc.Contains("terminal") || proc.Contains("code") || proc.Contains("cursor") || proc.Contains("powershell") || proc.Contains("cmd") || proc.Contains("conhost") || proc.Contains("alacritty") || proc.Contains("wezterm") || cls.Contains("CASCADIA");
                    if (isTerminalHost) {
                        score += 30;
                    }

                    // 2. PID 与进程树家族精确匹配 (最高加分 200)
                    if (familyPids.Contains(pId)) {
                        score += 200;
                    } else if (pid > 0 && pId == pid) {
                        score += 150;
                    }

                    // 3. 标题与 Agent 身份特征匹配
                    if (!string.IsNullOrEmpty(hint)) {
                        if (titleLower.Contains(hint)) score += 80;
                        if (hint.Contains("antigravity") || hint.Contains("agy")) {
                            if (titleLower.Contains("agy") || titleLower.Contains("antigravity")) score += 70;
                        }
                        if (hint.Contains("opencode") || hint.Contains("oc")) {
                            if (titleLower.Contains("opencode") || titleLower.Contains("oc")) score += 70;
                        }
                        if (hint.Contains("claude")) {
                            if (titleLower.Contains("claude")) score += 70;
                        }
                        if (hint.Contains("hermes")) {
                            if (titleLower.Contains("hermes")) score += 70;
                        }
                    }

                    // 4. 工作目录匹配
                    if (!string.IsNullOrEmpty(cwd) && titleLower.Contains(cwd)) {
                        score += 50;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        bestWnd = hWnd;
                        bestInfo = "HWND=" + hWnd + " PID=" + pId + " PROC=" + proc + " SCORE=" + score + " TITLE=" + title;
                    }
                }
                return true;
            }, IntPtr.Zero);

            Log("FindWindowForAgent (" + nameHint + ", PID " + pid + ") => " + (bestWnd != IntPtr.Zero ? bestInfo : "NOT_FOUND"));
            return bestWnd;
        }

        public static void Main(string[] args) {
            string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "send-key";
            string action = args.Length > 1 ? args[1].ToLowerInvariant() : "allow";
            uint targetPid = 0;
            if (args.Length > 2) {
                uint.TryParse(args[2], out targetPid);
            }
            string nameHint = args.Length > 3 ? args[3] : "";
            string cwdHint = args.Length > 4 ? args[4] : "";

            // 核心修复：按键字符精准化。如果是 allow 则发送 'y'，deny 发送 'n'；单字符选项则直接使用
            char targetChar = 'y';
            if (action == "deny") {
                targetChar = 'n';
            } else if (action == "allow") {
                targetChar = 'y';
            } else if (action.Length == 1) {
                targetChar = action[0];
            }

            Log("Invoked: mode=" + mode + ", action=" + action + ", targetPid=" + targetPid + ", name=" + nameHint + ", cwd=" + cwdHint);

            // 1. 检查当前前台窗口 (Foreground Window)
            IntPtr fgWnd = GetForegroundWindow();
            uint fgPid = 0;
            string fgProcName = "";
            if (fgWnd != IntPtr.Zero) {
                GetWindowThreadProcessId(fgWnd, out fgPid);
                try {
                    var p = Process.GetProcessById((int)fgPid);
                    fgProcName = p.ProcessName;
                } catch {}
            }

            // 如果是 focus（切回）模式：使用多维亲和性评分精准激活目标终端
            if (mode == "focus") {
                IntPtr w = FindWindowForAgent(targetPid, nameHint, cwdHint);
                if (w != IntPtr.Zero) {
                    ForceForeground(w);
                    Log("Focused window: " + w + " for PID " + targetPid + " name=" + nameHint);
                    Console.WriteLine("SUCCESS_FOCUSED");
                } else {
                    Log("No window found to focus for PID " + targetPid + " name=" + nameHint);
                    Console.WriteLine("NOT_FOUND");
                }
                return;
            }

            // 策略 A: 优先尝试控制台缓冲区原生注入（零前台依赖、零快捷键冲突、单次精准）
            uint candidatePid = targetPid > 0 ? targetPid : fgPid;
            if (candidatePid > 0) {
                bool ok = InjectKeyToConsoleBuffer(candidatePid, targetChar);
                if (!ok) {
                    uint ppid = GetParentProcessId(candidatePid);
                    if (ppid > 0) ok = InjectKeyToConsoleBuffer(ppid, targetChar);
                }
                if (ok) {
                    Log("Injected via console buffer directly.");
                    Console.WriteLine("SUCCESS_BUFFER");
                    return; // 成功即返回，绝对杜绝二次输入与死锁退出！
                }
            }

            // 策略 B: 针对 Windows Terminal / VSCode 等现代宿主，使用精准定位 + 定向 WM_CHAR 消息
            IntPtr targetWnd = FindWindowForAgent(targetPid, nameHint, cwdHint);
            if (targetWnd != IntPtr.Zero) {
                ForceForeground(targetWnd);
                Thread.Sleep(50);
                PostKeyToWindow(targetWnd, targetChar);
                Log("Posted WM_CHAR to targetWnd=" + targetWnd);
                Console.WriteLine("SUCCESS_POSTED");
            } else {
                SimulateKeyboard(targetChar);
                Console.WriteLine("SUCCESS_SIMULATED");
            }
        }
    }
}
