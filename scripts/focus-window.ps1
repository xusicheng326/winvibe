param(
    [int]$TargetPid,
    [string]$SendKeys = ""
)

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class ConsoleFocusHelper {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const int STD_INPUT_HANDLE = -10;

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

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

    public static IntPtr TryAttach(uint pid) {
        FreeConsole();
        if (AttachConsole(pid)) {
            IntPtr hWnd = GetConsoleWindow();
            if (hWnd != IntPtr.Zero && IsWindowVisible(hWnd)) {
                return hWnd;
            }
        }
        return IntPtr.Zero;
    }

    public static void ForceForeground(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return;
        if (IsIconic(hWnd)) {
            ShowWindow(hWnd, 9);
        } else {
            ShowWindow(hWnd, 5);
        }

        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);

        IntPtr fgWnd = GetForegroundWindow();
        uint dummyPid;
        uint fgThread = GetWindowThreadProcessId(fgWnd, out dummyPid);
        uint curThread = GetCurrentThreadId();

        if (fgThread != 0 && fgThread != curThread) {
            AttachThreadInput(curThread, fgThread, true);
        }

        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);

        if (fgThread != 0 && fgThread != curThread) {
            AttachThreadInput(curThread, fgThread, false);
        }
    }

    public static bool InjectKeyToConsole(uint pid, char c) {
        FreeConsole();
        if (!AttachConsole(pid)) return false;

        IntPtr hIn = GetStdHandle(STD_INPUT_HANDLE);
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
        FreeConsole();
        return ok && written > 0;
    }

    public static IntPtr FindVisibleWindow(uint targetPid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (pid == targetPid) {
                    result = hWnd;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@

Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue

$injected = $false

if (-not [string]::IsNullOrEmpty($SendKeys)) {
    $firstChar = if ($SendKeys -match '^[yY]') { [char]'y' } elseif ($SendKeys -match '^[nN]') { [char]'n' } else { [char]$SendKeys[0] }
    
    if ($TargetPid -gt 0) {
        $injected = [ConsoleFocusHelper]::InjectKeyToConsole([uint32]$TargetPid, $firstChar)
    }

    if (-not $injected -and $TargetPid -gt 0) {
        $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetPid" -ErrorAction SilentlyContinue
        if ($procInfo -and $procInfo.ParentProcessId) {
            $injected = [ConsoleFocusHelper]::InjectKeyToConsole([uint32]$procInfo.ParentProcessId, $firstChar)
        }
    }
}

$foundHwnd = [IntPtr]::Zero
$curr = $TargetPid
$visitedPids = @()

while ($curr -gt 0 -and $curr -notin $visitedPids) {
    $visitedPids += $curr
    
    $hwnd = [ConsoleFocusHelper]::TryAttach([uint32]$curr)
    if ($hwnd -ne [IntPtr]::Zero) {
        $foundHwnd = $hwnd
        break
    }

    $hwnd = [ConsoleFocusHelper]::FindVisibleWindow([uint32]$curr)
    if ($hwnd -ne [IntPtr]::Zero) {
        $foundHwnd = $hwnd
        break
    }

    $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $curr" -ErrorAction SilentlyContinue
    if ($null -eq $procInfo -or -not $procInfo.ParentProcessId) { break }
    $curr = $procInfo.ParentProcessId
}

if ($foundHwnd -eq [IntPtr]::Zero) {
    $terminals = Get-Process -Name WindowsTerminal, OpenConsole -ErrorAction SilentlyContinue
    foreach ($term in $terminals) {
        $hwnd = [ConsoleFocusHelper]::FindVisibleWindow([uint32]$term.Id)
        if ($hwnd -ne [IntPtr]::Zero) {
            $foundHwnd = $hwnd
            break
        }
    }
}

if ($foundHwnd -ne [IntPtr]::Zero) {
    [ConsoleFocusHelper]::ForceForeground($foundHwnd)
    
    if (-not $injected -and -not [string]::IsNullOrEmpty($SendKeys)) {
        Start-Sleep -Milliseconds 80
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait($SendKeys)
    }
    $logMsg = "[$(Get-Date -Format 'HH:mm:ss')] SUCCESS (Injected: $injected, Window: $foundHwnd)`r`n"
    Write-Output $logMsg
} else {
    if ($injected) {
        $logMsg = "[$(Get-Date -Format 'HH:mm:ss')] SUCCESS (Injected via Console Buffer)`r`n"
        Write-Output $logMsg
    } else {
        if (-not [string]::IsNullOrEmpty($SendKeys)) {
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.SendKeys]::SendWait($SendKeys)
            $logMsg = "[$(Get-Date -Format 'HH:mm:ss')] SUCCESS (SendKeys Fallback)`r`n"
            Write-Output $logMsg
        } else {
            $logMsg = "[$(Get-Date -Format 'HH:mm:ss')] NOT_FOUND`r`n"
            Write-Output $logMsg
        }
    }
}

try {
    $logDir = [System.IO.Path]::Combine($HOME, ".winvibe")
    if (-not [System.IO.Directory]::Exists($logDir)) { [System.IO.Directory]::CreateDirectory($logDir) | Out-Null }
    [System.IO.File]::AppendAllText([System.IO.Path]::Combine($logDir, "bridge.log"), $logMsg)
} catch {}
