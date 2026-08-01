const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Fait le pont sécurisé
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Écoute la demande d'éjection venant de l'interface
ipcMain.on('eject-cd', () => {
  console.log("Commande d'éjection reçue dans main.js !");
  
  const psCommand = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; namespace CDROM { public class Commands { [DllImport("winmm.dll")] public static extern Int32 mciSendString(string command, string buffer, int bufferSize, IntPtr hwndCallback); } }'; [CDROM.Commands]::mciSendString("set cdaudio door open", $null, 0, [IntPtr]::Zero)`;

  exec(`powershell -Command "${psCommand}"`, (err, stdout, stderr) => {
    if (err) {
      console.error("Erreur d'exécution PowerShell :", err);
    }
  });
});