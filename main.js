const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const https = require('https');

let DRIVE = 'F';

// ─── PowerShell persistent bridge ──────────────────────────────────────────
const BRIDGE_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Bridge {
  public class MCI {
    [DllImport("winmm.dll", CharSet = CharSet.Auto)]
    public static extern int mciSendString(string cmd, System.Text.StringBuilder ret, int retLen, IntPtr cb);
  }
}
"@ -Language CSharp

function Invoke-MCI($cmd) {
  $sb = New-Object System.Text.StringBuilder 512
  $err = [Bridge.MCI]::mciSendString($cmd, $sb, 512, [IntPtr]::Zero)
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

let psProc   = null;
let pending  = {};
let callId   = 0;
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
        const cb = pending[res.id];
        if (cb) { delete pending[res.id]; cb(res); }
      } catch(e) {}
    }
  });

  psProc.on('exit', () => {
    psProc = null;
    for (const id in pending) {
      pending[id]({ err: -1, val: 'Bridge exited' });
      delete pending[id];
    }
  });
}

function mci(cmd) {
  return new Promise((resolve, reject) => {
    if (!psProc) { reject(new Error('Bridge not started')); return; }
    const id = ++callId;
    pending[id] = (res) => {
      if (res.err !== 0) reject(new Error('MCI ' + res.err + ': ' + res.val));
      else resolve(res.val.trim());
    };
    psProc.stdin.write(JSON.stringify({ id, type: 'mci', cmd }) + '\n');
  });
}

// ─── Volume via nircmd ─────────────────────────────────────────────────────
function sendVolume(level) {
  const val = Math.round((Math.max(0, Math.min(100, level)) / 100) * 65535);
  const nircmd = path.join(__dirname, 'nircmd.exe');
  return new Promise((resolve) => {
    execFile(nircmd, ['setsysvolume', String(val)], () => resolve());
  });
}

// ─── Eject ─────────────────────────────────────────────────────────────────
function ejectDrive(letter) {
  return new Promise((resolve, reject) => {
    const lines = [
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
    ];
    const ps1 = path.join(os.tmpdir(), 'eject_' + Date.now() + '.ps1');
    fs.writeFileSync(ps1, lines.join('\r\n'), 'utf8');
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ps1], (err, stdout, stderr) => {
      try { fs.unlinkSync(ps1); } catch(e) {}
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function msfToSec(t) {
  if (!t) return 0;
  const p = t.trim().split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

// MSF string "mm:ss:ff" → frames (1 frame = 1/75 sec)
function msfToFrames(t) {
  if (!t) return 0;
  const p = t.trim().split(':').map(Number);
  return (p[0] || 0) * 60 * 75 + (p[1] || 0) * 75 + (p[2] || 0);
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

async function playTrack(trackNum) {
  const pos = await mci('status cd position track ' + trackNum);
  await mci('play cd from ' + pos);
}

// ─── MusicBrainz disc ID calculation ───────────────────────────────────────
// Spec: https://musicbrainz.org/doc/Disc_ID_Calculation
function calcDiscId(firstTrack, lastTrack, trackOffsets, leadoutOffset) {
  // trackOffsets: array of frame offsets for each track (1-based, index 0 = track 1)
  // leadoutOffset: frame offset of leadout track
  const crypto = require('crypto');

  // Build the 804-byte input string
  let str = '';
  str += firstTrack.toString(16).toUpperCase().padStart(2, '0');
  str += lastTrack.toString(16).toUpperCase().padStart(2, '0');
  // Leadout offset (slot 0)
  str += leadoutOffset.toString(16).toUpperCase().padStart(8, '0');
  // Track offsets slots 1-99
  for (let i = 0; i < 99; i++) {
    const offset = i < trackOffsets.length ? trackOffsets[i] : 0;
    str += offset.toString(16).toUpperCase().padStart(8, '0');
  }

  const hash = crypto.createHash('sha1').update(str, 'ascii').digest('base64');
  // MusicBrainz uses a modified base64: + → ., / → _, = → -
  return hash.replace(/\+/g, '.').replace(/\//g, '_').replace(/=/g, '-');
}

async function getTOC() {
  await ensureOpen();
  const numTracks = parseInt(await mci('status cd number of tracks')) || 0;
  if (numTracks === 0) return null;

  // MCI already returns frames including the 2-second pregap — do NOT add 150
  const offsets = [];
  for (let i = 1; i <= numTracks; i++) {
    const pos = await mci('status cd position track ' + i);
    offsets.push(msfToFrames(pos));
  }

  // Leadout = first track offset + total CD length
  const firstPos  = await mci('status cd position track 1');
  const totalLen  = await mci('status cd length');
  const leadout   = msfToFrames(firstPos) + msfToFrames(totalLen);

  const discId = calcDiscId(1, numTracks, offsets, leadout);
  return { discId, numTracks, offsets, leadout };
}

// ─── MusicBrainz API lookup ────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.get({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: { 'User-Agent': 'CDA-Electron/1.0 ( yohann@example.com )' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function lookupMusicBrainz(discId) {
  const url = `https://musicbrainz.org/ws/2/discid/${discId}?fmt=json&inc=artists+recordings`;
  const raw = await httpGet(url);
  const data = JSON.parse(raw);

  if (!data.releases || data.releases.length === 0) return null;

  const release = data.releases[0];
  const artist  = release['artist-credit']?.[0]?.artist?.name || 'Unknown Artist';
  const album   = release.title || 'Unknown Album';
  const date    = release.date || '';

  // Flatten all tracks from all media
  const tracks = [];
  for (const medium of (release.media || [])) {
    for (const track of (medium.tracks || [])) {
      tracks.push({
        number: track.number,
        title:  track.title || ('Track ' + track.number),
        length: track.length // ms
      });
    }
  }

  return { artist, album, date, tracks, discId };
}

// ─── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  startBridge();
  const win = new BrowserWindow({
    width: 680, height: 600,
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
        if (arg !== undefined) await playTrack(arg);
        else await mci('play cd');
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
        await sendVolume(arg);
        return { ok: true };

      case 'status':
        await ensureOpen();
        const mode   = await mci('status cd mode');
        const trk    = await mci('status cd current track');
        const total  = await mci('status cd number of tracks');
        const trkNum = parseInt(trk) || 1;
        const posAbs        = await mci('status cd position');
        const posTrackStart = await mci('status cd position track ' + trkNum);
        const tlen          = await mci('status cd length track ' + trkNum);
        const elapsed = Math.max(0, msfToSec(posAbs) - msfToSec(posTrackStart));
        return {
          ok: true,
          mode,
          track:       trkNum,
          numTracks:   parseInt(total) || 0,
          position:    elapsed,
          trackLength: msfToSec(tlen)
        };

      case 'lookup':
        const toc = await getTOC();
        if (!toc) return { ok: false, error: 'No CD found' };
        try {
          const meta = await lookupMusicBrainz(toc.discId);
          if (!meta) return { ok: true, found: false, discId: toc.discId };
          return { ok: true, found: true, ...meta };
        } catch(e) {
          return { ok: true, found: false, discId: toc.discId, error: e.message };
        }

      case 'reload':
        await forceReopen();
        const tot2 = await mci('status cd number of tracks');
        return { ok: true, numTracks: parseInt(tot2) || 0 };

      default:
        return { ok: false, error: 'Unknown command' };
    }
  } catch (e) {
    if (e.message && e.message.includes('MCI')) cdReady = false;
    return { ok: false, error: e.message || e.toString() };
  }
});
