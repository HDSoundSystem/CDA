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

// Exécute une commande MCI via un script PS1 temporaire (évite les problèmes d'escaping)
function runMciCommand(mciCmd) {
  return new Promise((resolve, reject) => {
    const ps1 = path.join(os.tmpdir(), `mci_${Date.now()}.ps1`);
    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace CDROM {
  public class Commands {
    [DllImport("winmm.dll")]
    public static extern Int32 mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
  }
}
"@
$sb = New-Object System.Text.StringBuilder(256)
[CDROM.Commands]::mciSendString("${mciCmd}", $sb, 256, [IntPtr]::Zero)
Write-Output $sb.ToString()
`;
    fs.writeFileSync(ps1, script, 'utf8');
    execFile('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ps1], (err, stdout, stderr) => {
      fs.unlinkSync(ps1);
      if (err) reject(stderr || err.message);
      else resolve(stdout.trim());
    });
  });
}

ipcMain.handle('cd-command', async (event, command) => {
  try {
    switch (command) {
      case 'open':
        await runMciCommand('open cdaudio alias cd shareable');
        return { ok: true };
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
        await runMciCommand('open cdaudio alias cd shareable');
        await runMciCommand('set cd door open');
        return { ok: true };
      case 'status':
        const status = await runMciCommand('status cd mode');
        return { ok: true, value: status };
      default:
        return { ok: false, error: 'Commande inconnue' };
    }
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
});
