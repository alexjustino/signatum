import { spawn } from 'node:child_process';

/**
 * Answer the next system file dialog the product opens, through Windows UI Automation.
 *
 * WebDriver drives the webview and nothing outside it, and Tauri keeps its IPC function out of the
 * page's reach, so a test cannot stand in for the dialog from inside the page. It does not need
 * to: the dialog is an ordinary Windows window. This finds the one owned by the product's process
 * (class `#32770`), finds its file-name box (the `Edit` whose control id is 1148) and its default
 * button (control id 1), writes the path into the box with `WM_SETTEXT` and presses the button
 * with `BM_CLICK` — the real dialog, answered through its own windows.
 *
 * No keystroke is sent to the desktop and no other window is touched: if the dialog never
 * appears, nothing happens, the helper gives up after `timeoutMs`, and the promise rejects with
 * the reason.
 *
 * Start it **before** the click that opens the dialog, and await it after:
 *
 *     const answered = answerDialog(file);
 *     await button.click();
 *     await answered;
 */
export function answerDialog(file: string, timeoutMs = 15_000): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace Signatum -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr SendMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, string lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
'@
$A = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
function Condition($property, $value) {
  New-Object System.Windows.Automation.PropertyCondition($property, $value)
}
function Both($a, $b) { New-Object System.Windows.Automation.AndCondition($a, $b) }
$ids = @(Get-Process -Name signatum -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($ids.Count -eq 0) { throw 'the product is not running' }
$isNameBox = Both (Condition $A::ClassNameProperty 'Edit') (Condition $A::AutomationIdProperty '1148')
$isButton = Both (Condition $A::ClassNameProperty 'Button') (Condition $A::AutomationIdProperty '1')
$deadline = (Get-Date).AddMilliseconds(${timeoutMs})
$nameBox = $null
$button = $null
while (-not $nameBox -and (Get-Date) -lt $deadline) {
  foreach ($id in $ids) {
    $dialogs = $A::RootElement.FindAll($Scope::Descendants,
      (Both (Condition $A::ProcessIdProperty $id) (Condition $A::ClassNameProperty '#32770')))
    foreach ($dialog in $dialogs) {
      $box = $dialog.FindFirst($Scope::Descendants, $isNameBox)
      $ok = $dialog.FindFirst($Scope::Descendants, $isButton)
      if ($box -and $ok) { $nameBox = $box; $button = $ok; break }
    }
    if ($nameBox) { break }
  }
  if (-not $nameBox) { Start-Sleep -Milliseconds 200 }
}
if (-not $nameBox) { throw 'no file dialog with a file-name box appeared' }
$WM_SETTEXT = 0x000C
$BM_CLICK = 0x00F5
[Signatum.Win32]::SendMessage([System.IntPtr]$nameBox.Current.NativeWindowHandle, $WM_SETTEXT, [System.IntPtr]::Zero, $env:SIGNATUM_DIALOG_ANSWER) | Out-Null
[Signatum.Win32]::PostMessage([System.IntPtr]$button.Current.NativeWindowHandle, $BM_CLICK, [System.IntPtr]::Zero, [System.IntPtr]::Zero) | Out-Null
`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, SIGNATUM_DIALOG_ANSWER: file },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`the dialog was not answered: ${errors.trim().split('\n')[0] ?? code}`));
    });
  });
}
