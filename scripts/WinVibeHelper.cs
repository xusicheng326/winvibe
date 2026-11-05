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
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

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

            // 仅在窗口被最小化时才恢复窗口，避免正常窗口触发重绘动画
            if (IsIconic(hWnd)) {
                ShowWindow(hWnd, 9); // SW_RESTORE
            }

            uint dummyPid;
            uint fgThread = GetWindowThreadProcessId(fgWnd, out dummyPid);
            uint curThread = GetCurrentThreadId();

            if (fgThread != 0 && fgThread != curThread) {
                AttachThreadInput(curThread, fgThread, true);
            }

            SetForegroundWindow(hWnd);
            BringWindowToTop(hWnd);

            if (fgThread != 0 && fgThread != curThread) {
                AttachThreadInput(curThread, fgThread, false);
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
                   procName.Contains("windowsterminal") ||
                   procName.Contains("openconsole") ||
                   procName.Contains("conhost") ||
                   procName.Contains("mintty") ||
                   procName.Contains("bash") ||
                   procName.Contains("code") ||
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

        public static IntPtr FindWindowForPidChain(uint pid) {
            EnsureInteractiveDesktop();
            uint curr = pid;
            for (int i = 0; i < 6 && curr > 0; i++) {
                IntPtr found = IntPtr.Zero;
                uint searchPid = curr;
                EnumWindows((hWnd, lParam) => {
                    if (IsWindowVisible(hWnd)) {
                        uint pId;
                        GetWindowThreadProcessId(hWnd, out pId);
                        if (pId == searchPid) {
                            var sb = new StringBuilder(256);
                            GetClassName(hWnd, sb, 256);
                            string cls = sb.ToString();
                            found = hWnd;
                            return false;
                        }
                    }
                    return true;
                }, IntPtr.Zero);

                if (found != IntPtr.Zero) return found;
                curr = GetParentProcessId(curr);
            }
            return IntPtr.Zero;
        }

        public static void Main(string[] args) {
            string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "send-key";
            string action = args.Length > 1 ? args[1].ToLowerInvariant() : "allow";
            uint targetPid = 0;
            if (args.Length > 2) {
                uint.TryParse(args[2], out targetPid);
            }

            char keyChar = (action == "deny") ? 'n' : 'y';
            char numChar = (action == "deny") ? '4' : '1';

            Log("Invoked: mode=" + mode + ", action=" + action + ", targetPid=" + targetPid);

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

            Log("Foreground window: hWnd=" + fgWnd + ", pid=" + fgPid + ", proc=" + fgProcName);

            // 如果仅是 focus 模式
            if (mode == "focus") {
                IntPtr w = FindWindowForPidChain(targetPid);
                if (w != IntPtr.Zero) {
                    ForceForeground(w);
                    Log("Focused window: " + w + " for PID " + targetPid);
                    Console.WriteLine("SUCCESS_FOCUSED");
                } else {
                    Log("No window found to focus for PID " + targetPid);
                    Console.WriteLine("NOT_FOUND");
                }
                return;
            }

            // 优先直接向目标进程（及父进程）的控制台缓冲区注入（无需窗口激活，100% 不闪屏、不依赖前台）
            bool directInjected = false;
            uint candidatePid = targetPid > 0 ? targetPid : fgPid;
            if (candidatePid > 0) {
                // 成功注入缓冲后即可返回，避免同时注入缓冲又模拟全局按键导致发了两次
                directInjected = InjectKeyToConsoleBuffer(candidatePid, numChar);
                if (!directInjected) {
                    uint ppid = GetParentProcessId(candidatePid);
                    if (ppid > 0) {
                        directInjected = InjectKeyToConsoleBuffer(ppid, numChar);
                    }
                }
                Log("Direct InjectKeyToConsoleBuffer on " + candidatePid + ": " + directInjected);
                if (directInjected) {
                    Console.WriteLine("SUCCESS_BUFFER_DIRECT");
                    return;
                }
            }

            // 策略 A: 如果当前前台窗口就是终端，或者用户正停留在该终端界面
            if (IsTerminalProcess(fgProcName) && !fgProcName.ToLowerInvariant().Contains("winvibe")) {
                Log("Foreground is terminal (" + fgProcName + "). Injecting to foreground window.");
                SimulateKeyboard(numChar);
                Console.WriteLine("SUCCESS_FOREGROUND");
                return;
            }

            // 策略 B: 前台不是终端，查找目标进程树的窗口
            IntPtr targetWnd = IntPtr.Zero;
            uint chosenPid = targetPid;

            if (targetPid > 0) {
                targetWnd = FindWindowForPidChain(targetPid);
            }

            // 若仍未找到窗口，按 Z-Order 顺序寻找当前最顶层的终端窗口
            if (targetWnd == IntPtr.Zero) {
                EnumWindows((hWnd, lParam) => {
                    if (IsWindowVisible(hWnd)) {
                        uint pId;
                        GetWindowThreadProcessId(hWnd, out pId);
                        try {
                            var p = Process.GetProcessById((int)pId);
                            string name = p.ProcessName.ToLowerInvariant();
                            if (IsTerminalProcess(name) && !name.Contains("winvibe")) {
                                targetWnd = hWnd;
                                chosenPid = pId;
                                return false; // 获取 Z-Order 顶层终端
                            }
                        } catch {}
                    }
                    return true;
                }, IntPtr.Zero);
            }

            Log("Target resolved: hWnd=" + targetWnd + ", chosenPid=" + chosenPid);

            if (targetWnd != IntPtr.Zero) {
                if (targetWnd != fgWnd) {
                    ForceForeground(targetWnd);
                    Thread.Sleep(30);
                }
                SimulateKeyboard(numChar);
                Log("Sent keyboard simulation to window " + targetWnd + ".");
                Console.WriteLine("SUCCESS_TARGET_WINDOW");
            } else if (directInjected) {
                Console.WriteLine("SUCCESS_BUFFER_ONLY");
            } else {
                SimulateKeyboard(numChar);
                Log("Fallback keyboard simulation executed.");
                Console.WriteLine("SUCCESS_FALLBACK");
            }
        }
    }
}
