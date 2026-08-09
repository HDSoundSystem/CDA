const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

let DRIVE = 'F';

// ─── Processus PowerShell persistant ───────────────────────────────────────
const BRIDGE_SCRIPT = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace MCI {
  public class Api {
    [DllImport("winmm.dll", CharSet = CharSet.Auto)]
    public static extern int mciSendString(string cmd, System.Text.StringBuilder ret, int retLen, IntPtr cb);
  }
}
"@

function Invoke-MCI($cmd) {
  $sb = New-Object System.Text.StringBuilder 512
  $err = [MCI.Api]::mciSendString($cmd, $sb, 512, [IntPtr]::Zero)
  return @{ err = $err; val = $sb.ToString() }
}

while ($true) {
  $line = [Console]::ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  try {
    $req = $line | ConvertFrom-Json
    $r = Invoke-MCI $req.cmd
    Write-Output ((@{ id = $req.id; err = $r.err; val = $r.val }) | ConvertTo-Json -Compress)
  } catch {
    Write-Output ((@{ id = 0; err = -1; val = $_.ToString() }) | ConvertTo-Json -Compress)
  }
  [Console]::Out.Flush()
}
`;

let psProc = null;
let pendingCalls = {};
let callId = 0;
let psBuffer = '';

function startBridge() {
  if (psProc) return;
  const scriptPath = path.join(os.tmpdir(), 'mci_bridge.ps1');
  fs.writeFileSync(scriptPath, BRIDGE_SCRIPT, 'utf8');
  psProc = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  psProc.stdout.on('data', (chunk) => {
    psBuffer += chunk.toString();
    let nl;
    while ((nl = psBuffer.indexOf('\n')) !== -1) {
      const line = psBuffer.slice(0, nl).trim();
      psBuffer = psBuffer.slice(nl + 1);
      if (!line) continue;
      try {
        const res = JSON.parse(line);
        const cb = pendingCalls[res.id];
        if (cb) { delete pendingCalls[res.id]; cb(res); }
      } catch(e) {}
    }
  });

  psProc.on('exit', () => {
    psProc = null;
    for (const id in pendingCalls) {
      pendingCalls[id]({ err: -1, val: 'Bridge exited' });
      delete pendingCalls[id];
    }
  });
}

function mci(cmd) {
  return new Promise((resolve, reject) => {
    if (!psProc) { reject(new Error('Bridge not started')); return; }
    const id = ++callId;
    pendingCalls[id] = (res) => {
      if (res.err !== 0) reject(new Error('MCI ' + res.err + ': ' + res.val));
      else resolve(res.val.trim());
    };
    psProc.stdin.write(JSON.stringify({ id, cmd }) + '\n');
  });
}

// ─── Eject ─────────────────────────────────────────────────────────────────
function ejectDrive(letter) {
  return new Promise((resolve, reject) => {
    const script = [
      'Add-Type -TypeDefinition @"',
      'using System; using System.Runtime.InteropServices;',
      'namespace Ej {',
      '  public class D {',
      '    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Auto)]',
      '    public static extern IntPtr CreateFile(string f,uint a,uint s,IntPtr sec,uint cd,uint fa,IntPtr t);',
      '    [DllImport("kernel32.dll",SetLastError=true)]',
      '    public static extern bool DeviceIoControl(IntPtr h,uint c,IntPtr i,uint ni,IntPtr o,uint no,out uint b,IntPtr ov);',
      '    [DllImport("kernel32.dll",SetLastError=true)]',
      '    public static extern bool CloseHandle(IntPtr h);',
      '    public static void Eject(string d){',
      '      var h=CreateFile(@"\\\\.\\"+d,0xC0000000,3,IntPtr.Zero,3,0,IntPtr.Zero);',
      '      uint b=0; DeviceIoControl(h,0x2D4808,IntPtr.Zero,0,IntPtr.Zero,0,out b,IntPtr.Zero);',
      '      CloseHandle(h);',
      '    }',
      '  }',
      '}',
      '"@',
      '[Ej.D]::Eject("' + letter + ':")',
      'Write-Output "ok"'
    ].join('\r\n');
    const ps1 = path.join(os.tmpdir(), 'eject_' + Date.now() + '.ps1');
    fs.writeFileSync(ps1, script, 'utf8');
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ps1], (err, stdout, stderr) => {
      try { fs.unlinkSync(ps1); } catch(e) {}
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ─── Volume via nircmd OU wscript ──────────────────────────────────────────
// setaudio MCI est ignoré sur Win10/11. On utilise PowerShell CoreAudio API.
function setVolume(percent) {
  return new Promise((resolve) => {
    const vol = Math.max(0, Math.min(100, percent)) / 100;
    const script = [
      'Add-Type -TypeDefinition @"',
      'using System.Runtime.InteropServices;',
      '[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]',
      '[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
      'interface IAudioEndpointVolume {',
      '  int f1(); int f2(); int f3(); int f4();',
      '  int SetMasterVolumeLevelScalar(float f, System.Guid g);',
      '  int f6();',
      '  int GetMasterVolumeLevelScalar(out float f);',
      '  int f8(); int f9(); int f10(); int f11(); int f12();',
      '}',
      '[Guid("D666063F-1587-4E43-81F1-B948E807363F")]',
      '[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
      'interface IMMDevice { int Activate(ref System.Guid i,int c,System.IntPtr p,out object o); int f2(); int f3(); }',
      '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]',
      '[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
      'interface IMMDeviceEnumerator { int f1(); int GetDefaultAudioEndpoint(int f,int r,out IMMDevice d); }',
      '[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]',
      'class MMDeviceEnumeratorClass {}',
      'public class Vol {',
      '  public static void Set(float v){',
      '    var e=(IMMDeviceEnumerator)new MMDeviceEnumeratorClass();',
      '    IMMDevice d; e.GetDefaultAudioEndpoint(0,1,out d);',
      '    var g=new System.Guid("5CDF2C82-841E-4546-9722-0CF74078229A");',
      '    object o; d.Activate(ref g,0,System.IntPtr.Zero,out o);',
      '    ((IAudioEndpointVolume)o).SetMasterVolumeLevelScalar(v,System.Guid.Empty);',
      '  }',
      '}',
      '"@ -Language CSharp',
      '[Vol]::Set(' + vol.toFixed(4) + ')',
      'Write-Output "ok"'
    ].join('\r\n');
    const ps1 = path.join(os.tmpdir(), 'vol_' + Date.now() + '.ps1');
    fs.writeFileSync(ps1, script, 'utf8');
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ps1], () => {
      try { fs.unlinkSync(ps1); } catch(e) {}
      resolve();
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function msfToSec(t) {
  if (!t) return 0;
  const p = t.trim().split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

let cdReady = false;

async function ensureOpen() {
  if (cdReady) return;
  try { await mci('close cd'); } catch(e) {}
  await mci('open cdaudio alias cd shareable');
  await mci('set cd time format msf');
  cdReady = true;
}

async function forceReopen() {
  try { await mci('close cd'); } catch(e) {}
  cdReady = false;
  await ensureOpen();
}

// Récupère la position de début d'une piste en MSF puis joue depuis là
async function playTrack(trackNum) {
  // "status cd position track N" retourne la position MSF de début de piste
  const pos = await mci('status cd position track ' + trackNum);
  await mci('play cd from ' + pos);
}

// ─── Fenêtre ───────────────────────────────────────────────────────────────
function createWindow() {
  startBridge();
  const win = new BrowserWindow({
    width: 650, height: 540,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile('index.html');
  win.on('closed', () => { if (psProc) psProc.kill(); });
}

app.whenReady().then(createWindow);

// ─── IPC ───────────────────────────────────────────────────────────────────
ipcMain.handle('cd-command', async (event, command, arg) => {
  try {
    switch (command) {

      case 'set-drive':
        try { await mci('close cd'); } catch(e) {}
        cdReady = false;
        DRIVE = (arg || 'F').replace(':', '').toUpperCase();
        return { ok: true, drive: DRIVE };

      case 'get-drive':
        return { ok: true, drive: DRIVE };

      case 'play':
        await ensureOpen();
        if (arg !== undefined) {
          await playTrack(arg);
        } else {
          await mci('play cd');
        }
        return { ok: true };

      case 'pause':
        await mci('pause cd');
        return { ok: true };

      case 'resume':
        await mci('resume cd');
        return { ok: true };

      case 'stop':
        await mci('stop cd');
        return { ok: true };

      case 'eject':
        try { await mci('close cd'); } catch(e) {}
        cdReady = false;
        await ejectDrive(DRIVE);
        return { ok: true };

      case 'prev':
        await ensureOpen();
        const cp = parseInt(await mci('status cd current track')) || 1;
        const tp = Math.max(1, cp - 1);
        await playTrack(tp);
        return { ok: true, track: tp };

      case 'next':
        await ensureOpen();
        const cn = parseInt(await mci('status cd current track')) || 1;
        const tn = parseInt(await mci('status cd number of tracks')) || 1;
        const nx = Math.min(tn, cn + 1);
        await playTrack(nx);
        return { ok: true, track: nx };

      case 'volume':
        await setVolume(arg);
        return { ok: true };

      case 'status':
        await ensureOpen();
        const mode  = await mci('status cd mode');
        const trk   = await mci('status cd current track');
        const total = await mci('status cd number of tracks');
        const pos   = await mci('status cd position');
        const tlen  = await mci('status cd length track ' + (parseInt(trk) || 1));
        return {
          ok: true,
          mode,
          track:       parseInt(trk)   || 0,
          numTracks:   parseInt(total) || 0,
          position:    msfToSec(pos),
          trackLength: msfToSec(tlen)
        };

      case 'reload':
        await forceReopen();
        const tot2 = await mci('status cd number of tracks');
        return { ok: true, numTracks: parseInt(tot2) || 0 };

      default:
        return { ok: false, error: 'Commande inconnue' };
    }
  } catch (e) {
    if (e.message && e.message.includes('MCI')) cdReady = false;
    return { ok: false, error: e.message || e.toString() };
  }
});
