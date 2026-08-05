const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

let DRIVE = 'F';
let cdOpen = false;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 650,
    height: 540,
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

function runMci(cmd) {
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
    '$sb = New-Object System.Text.StringBuilder(512)',
    '[CDROM.Commands]::mciSendString("' + cmd + '", $sb, 512, [IntPtr]::Zero)',
    'Write-Output $sb.ToString()'
  ].join('\r\n');
  return runPs1(script);
}

// Ouvre le CD une seule fois, sans spécifier la lettre (Windows trouve automatiquement)
async function openCd() {
  if (cdOpen) return;
  try {
    await runMci('open cdaudio alias cd shareable');
    await runMci('set cd time format msf');
    cdOpen = true;
  } catch(e) {
    cdOpen = false;
    throw e;
  }
}

async function closeCd() {
  try { await runMci('close cd'); } catch(e) {}
  cdOpen = false;
}

// Convertit "mm:ss:ff" en secondes
function msfToSeconds(t) {
  if (!t) return 0;
  const parts = t.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 60 + parts[1]; // ignore frames
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(t) || 0;
}

function ejectDrive() {
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
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
    '      if (h == new IntPtr(-1)) throw new Exception("Cannot open drive");',
    '      uint bytes = 0;',
    '      DeviceIoControl(h, 0x2D4808, IntPtr.Zero, 0, IntPtr.Zero, 0, out bytes, IntPtr.Zero);',
    '      CloseHandle(h);',
    '    }',
    '  }',
    '}',
    '"@',
    '[Eject.Drive]::Eject("' + DRIVE + ':")',
    'Write-Output "ok"'
  ].join('\r\n');
  return runPs1(script);
}

ipcMain.handle('cd-command', async (event, command, arg) => {
  try {
    switch (command) {

      case 'set-drive':
        await closeCd();
        DRIVE = (arg || 'F').replace(':', '').toUpperCase();
        return { ok: true, drive: DRIVE };

      case 'get-drive':
        return { ok: true, drive: DRIVE };

      case 'play':
        await openCd();
        if (arg !== undefined) {
          await runMci('play cd from ' + arg);
        } else {
          await runMci('play cd');
        }
        return { ok: true };

      case 'pause':
        await runMci('pause cd');
        return { ok: true };

      case 'resume':
        await runMci('resume cd');
        return { ok: true };

      case 'stop':
        await runMci('stop cd');
        return { ok: true };

      case 'eject':
        await closeCd();
        await ejectDrive();
        return { ok: true };

      case 'prev':
        await openCd();
        const curPrev   = await runMci('status cd current track');
        const trackPrev = Math.max(1, parseInt(curPrev) - 1);
        await runMci('play cd from ' + trackPrev);
        return { ok: true, track: trackPrev };

      case 'next':
        await openCd();
        const curNext   = await runMci('status cd current track');
        const totalNext = await runMci('status cd number of tracks');
        const trackNext = Math.min(parseInt(totalNext), parseInt(curNext) + 1);
        await runMci('play cd from ' + trackNext);
        return { ok: true, track: trackNext };

      case 'volume':
        const vol = Math.round((arg / 100) * 1000);
        await runMci('setaudio cd volume to ' + vol);
        return { ok: true };

      case 'status':
        await openCd();
        const mode      = await runMci('status cd mode');
        const track     = await runMci('status cd current track');
        const numTracks = await runMci('status cd number of tracks');
        const posRaw    = await runMci('status cd position');
        const tLenRaw   = await runMci('status cd length track ' + (parseInt(track) || 1));
        return {
          ok: true,
          mode,
          track:       parseInt(track) || 1,
          numTracks:   parseInt(numTracks) || 0,
          position:    msfToSeconds(posRaw),
          trackLength: msfToSeconds(tLenRaw)
        };

      default:
        return { ok: false, error: 'Commande inconnue' };
    }
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
});
