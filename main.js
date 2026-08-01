const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

function runPs1(script) {
  return new Promise((resolve, reject) => {
    const ps1 = path.join(os.tmpdir(), 'cd_' + Date.now() + '.ps1');
    fs.writeFileSync(ps1, script, 'utf8');
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ps1], (err, stdout, stderr) => {
      try { fs.unlinkSync(ps1); } catch(e) {}
      if (err) reject(stderr || err.message);
      else resolve(stdout.trim());
    });
  });
}

function runMciCommand(mciCmd) {
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'namespace CDROM {',
    '  public class Commands {',
    '    [DllImport("winmm.dll")]',
    '    public static extern Int32 mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, IntPtr hwndCallback);',
    '  }',
    '}',
    '"@',
    '$sb = New-Object System.Text.StringBuilder(256)',
    '[CDROM.Commands]::mciSendString("' + mciCmd + '", $sb, 256, [IntPtr]::Zero)',
    'Write-Output $sb.ToString()'
  ].join('\r\n');
  return runPs1(script);
}

function ejectDrive(driveLetter) {
  // Utilise DeviceIoControl IOCTL_STORAGE_EJECT_MEDIA — méthode la plus fiable sur Win10/11
  const letter = (driveLetter || 'D').replace(':', '').toUpperCase();
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.IO;',
    'namespace Eject {',
    '  public class Drive {',
    '    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Auto)]',
    '    public static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess,',
    '      uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition,',
    '      uint dwFlagsAndAttributes, IntPtr hTemplateFile);',
    '    [DllImport("kernel32.dll", SetLastError=true)]',
    '    public static extern bool DeviceIoControl(IntPtr hDevice, uint dwIoControlCode,',
    '      IntPtr lpInBuffer, uint nInBufferSize, IntPtr lpOutBuffer, uint nOutBufferSize,',
    '      out uint lpBytesReturned, IntPtr lpOverlapped);',
    '    [DllImport("kernel32.dll", SetLastError=true)]',
    '    public static extern bool CloseHandle(IntPtr hObject);',
    '    public static void Eject(string drive) {',
    '      IntPtr h = CreateFile(@"\\\\.\\" + drive, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);',
    '      if (h == new IntPtr(-1)) throw new Exception("Cannot open drive: " + drive);',
    '      uint bytes = 0;',
    '      DeviceIoControl(h, 0x2D4808, IntPtr.Zero, 0, IntPtr.Zero, 0, out bytes, IntPtr.Zero);',
    '      CloseHandle(h);',
    '    }',
    '  }',
    '}',
    '"@',
    '[Eject.Drive]::Eject("' + letter + ':")',
    'Write-Output "ok"'
  ].join('\r\n');
  return runPs1(script);
}

ipcMain.handle('cd-command', async (event, command, arg) => {
  try {
    switch (command) {
      case 'play':
        await runMciCommand('open cdaudio alias cd shareable');
        await runMciCommand('play cd');
        return { ok: true };
      case 'pause':
        await runMciCommand('pause cd');
        return { ok: true };
      case 'stop':
        await runMciCommand('stop cd');
        return { ok: true };
      case 'eject':
        await ejectDrive(arg || 'D');
        return { ok: true };
      case 'status':
        await runMciCommand('open cdaudio alias cd shareable');
        const status = await runMciCommand('status cd mode');
        return { ok: true, value: status };
      default:
        return { ok: false, error: 'Commande inconnue' };
    }
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
});
