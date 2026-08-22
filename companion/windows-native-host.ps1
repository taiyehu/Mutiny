param()

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class MutinyWindows {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct MONITORINFO { public int Size; public RECT Monitor; public RECT Work; public uint Flags; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint Type; public INPUTUNION Data; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT Mouse;
    [FieldOffset(0)] public KEYBDINPUT Keyboard;
    [FieldOffset(0)] public HARDWAREINPUT Hardware;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int X, Y; public uint MouseData, Flags, Time; public IntPtr ExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort VirtualKey, ScanCode; public uint Flags, Time; public IntPtr ExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT { public uint Message; public ushort ParamLow, ParamHigh; }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);

  static MutinyWindows() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    catch { try { SetProcessDPIAware(); } catch { } }
  }

  public static bool GetVisibleBounds(IntPtr hwnd, out RECT rect) {
    if (DwmGetWindowAttribute(hwnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) == 0) return true;
    return GetWindowRect(hwnd, out rect);
  }

  public static object[] ListWindows() {
    var windows = new List<object>();
    EnumWindows((hwnd, state) => {
      if (!IsWindowVisible(hwnd)) return true;
      var title = new StringBuilder(512);
      GetWindowText(hwnd, title, title.Capacity);
      RECT rect;
      if (title.Length == 0 || !GetVisibleBounds(hwnd, out rect) || rect.Right - rect.Left < 64 || rect.Bottom - rect.Top < 64) return true;
      windows.Add(new { id = "win:" + hwnd.ToInt64(), title = title.ToString(), width = rect.Right - rect.Left, height = rect.Bottom - rect.Top });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  public static bool Activate(long handle) {
    var hwnd = new IntPtr(handle);
    if (!IsWindow(hwnd)) return false;
    if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
    else ShowWindow(hwnd, 5);

    var foreground = GetForegroundWindow();
    uint ignored;
    var currentThread = GetCurrentThreadId();
    var foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out ignored);
    var targetThread = GetWindowThreadProcessId(hwnd, out ignored);
    var attachedForeground = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    var attachedTarget = targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread && AttachThreadInput(currentThread, targetThread, true);
    try {
      BringWindowToTop(hwnd);
      SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x0001u | 0x0002u | 0x0040u);
      SetForegroundWindow(hwnd);
      SetFocus(hwnd);
    } finally {
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
    }
    Thread.Sleep(75);
    return GetAncestor(GetForegroundWindow(), 2) == hwnd;
  }

  public static bool IsCenterVisible(long handle) {
    var hwnd = new IntPtr(handle);
    RECT rect;
    if (!GetVisibleBounds(hwnd, out rect)) return false;
    var center = new POINT(rect.Left + Math.Max(1, rect.Right - rect.Left) / 2, rect.Top + Math.Max(1, rect.Bottom - rect.Top) / 2);
    return GetAncestor(WindowFromPoint(center), 2) == hwnd;
  }

  public static int[] Bounds(long handle) {
    RECT rect;
    if (!GetVisibleBounds(new IntPtr(handle), out rect)) return null;
    return new[] { rect.Left, rect.Top, rect.Right, rect.Bottom };
  }

  public static int[] PointerBounds(long handle, string surface) {
    var hwnd = new IntPtr(handle);
    if (surface == "monitor") {
      var monitor = MonitorFromWindow(hwnd, 2);
      var info = new MONITORINFO { Size = Marshal.SizeOf(typeof(MONITORINFO)) };
      if (monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info)) {
        return new[] { info.Monitor.Left, info.Monitor.Top, info.Monitor.Right, info.Monitor.Bottom };
      }
    }
    return Bounds(handle);
  }

  public static void Pointer(long handle, double normalizedX, double normalizedY, string action, int button, string surface) {
    var bounds = PointerBounds(handle, surface);
    if (bounds == null) throw new InvalidOperationException("The target window is closed");
    var x = bounds[0] + (int)Math.Round(Math.Max(0, Math.Min(1, normalizedX)) * Math.Max(1, bounds[2] - bounds[0] - 1));
    var y = bounds[1] + (int)Math.Round(Math.Max(0, Math.Min(1, normalizedY)) * Math.Max(1, bounds[3] - bounds[1] - 1));
    if ((action == "down" || action == "click") && !Activate(handle)) throw new InvalidOperationException("Unable to focus the target window; click it locally once and retry");
    SetCursorPos(x, y);
    if ((action == "down" || action == "click") && GetAncestor(WindowFromPoint(new POINT(x, y)), 2) != new IntPtr(handle)) throw new InvalidOperationException("The selected point is covered by another window");
    uint down = button == 2 ? 0x0008u : button == 1 ? 0x0020u : 0x0002u;
    uint up = button == 2 ? 0x0010u : button == 1 ? 0x0040u : 0x0004u;
    if (action == "down" || action == "click") mouse_event(down, 0, 0, 0, UIntPtr.Zero);
    if (action == "up" || action == "click") mouse_event(up, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Key(long handle, int virtualKey, string code, bool down) {
    if (!Activate(handle)) throw new InvalidOperationException("Unable to focus the target window; click it locally once and retry");
    var scanCode = (ushort)MapVirtualKey((uint)virtualKey, 0);
    var extended = code == "ArrowLeft" || code == "ArrowUp" || code == "ArrowRight" || code == "ArrowDown" ||
      code == "Insert" || code == "Delete" || code == "Home" || code == "End" || code == "PageUp" || code == "PageDown" ||
      code == "ControlRight" || code == "AltRight" || code == "NumpadDivide" || code == "NumpadEnter";
    uint flags = scanCode == 0 ? 0u : 0x0008u;
    if (extended) flags |= 0x0001u;
    if (!down) flags |= 0x0002u;
    var input = new INPUT {
      Type = 1,
      Data = new INPUTUNION { Keyboard = new KEYBDINPUT {
        VirtualKey = scanCode == 0 ? (ushort)virtualKey : (ushort)0,
        ScanCode = scanCode,
        Flags = flags,
        Time = 0,
        ExtraInfo = IntPtr.Zero,
      } },
    };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) throw new InvalidOperationException("SEND_INPUT_FAILED");
  }
}
'@

function Send-Result($value) {
  [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
  try {
    $message = $line | ConvertFrom-Json
    switch ($message.command) {
      "list" { Send-Result @{ id = $message.id; ok = $true; windows = [MutinyWindows]::ListWindows() } }
      "bounds" {
        $bounds = [MutinyWindows]::Bounds([long]$message.handle)
        if ($null -eq $bounds) { throw "TARGET_CLOSED" }
        Send-Result @{ id = $message.id; ok = $true; bounds = $bounds }
      }
      "activate" {
        if (-not [MutinyWindows]::Activate([long]$message.handle)) { throw "ACTIVATION_FAILED" }
        if (-not [MutinyWindows]::IsCenterVisible([long]$message.handle)) { throw "TARGET_COVERED" }
        Send-Result @{ id = $message.id; ok = $true }
      }
      "pointer" {
        [MutinyWindows]::Pointer([long]$message.handle, [double]$message.x, [double]$message.y, [string]$message.action, [int]$message.button, [string]$message.surface)
        Send-Result @{ id = $message.id; ok = $true }
      }
      "key" {
        [MutinyWindows]::Key([long]$message.handle, [int]$message.virtualKey, [string]$message.code, [bool]$message.down)
        Send-Result @{ id = $message.id; ok = $true }
      }
      default { throw "UNKNOWN_COMMAND" }
    }
  } catch {
    Send-Result @{ id = $message.id; ok = $false; error = $_.Exception.Message }
  }
}
