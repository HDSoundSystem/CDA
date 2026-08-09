const statusText   = document.getElementById('status-text');
const trackNum     = document.getElementById('track-num');
const trackTotal   = document.getElementById('track-total');
const timeElapsed  = document.getElementById('time-elapsed');
const timeTotal    = document.getElementById('time-total');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue  = document.getElementById('volume-value');
const driveSelect  = document.getElementById('drive-select');

let pollInterval = null;
let currentMode  = '';
let lastNumTracks = 0;

function fmt(sec) {
  const s = Math.floor(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function send(cmd, arg) {
  try {
    const result = await window.electronAPI.cdCommand(cmd, arg);
    if (result && !result.ok) {
      statusText.innerText = 'Erreur : ' + result.error;
    }
    return result || { ok: false };
  } catch(e) {
    statusText.innerText = 'Erreur IPC';
    return { ok: false };
  }
}

function resetDisplay() {
  trackNum.innerText    = '--';
  trackTotal.innerText  = '--';
  timeElapsed.innerText = '0:00';
  timeTotal.innerText   = '0:00';
  lastNumTracks = 0;
}

async function poll() {
  const r = await send('status');
  if (!r.ok) return;

  currentMode = r.mode;

  // Détection insertion CD (numTracks passe de 0 à N)
  if (r.numTracks > 0 && lastNumTracks === 0) {
    statusText.innerText = r.numTracks + ' piste(s) détectée(s)';
  }
  lastNumTracks = r.numTracks;

  trackNum.innerText    = r.numTracks > 0 ? (r.track || '--') : '--';
  trackTotal.innerText  = r.numTracks > 0 ? r.numTracks : '--';
  timeElapsed.innerText = r.position    > 0 ? fmt(r.position)    : '0:00';
  timeTotal.innerText   = r.trackLength > 0 ? fmt(r.trackLength) : '0:00';

  if      (r.mode === 'playing') statusText.innerText = 'Lecture en cours';
  else if (r.mode === 'paused')  statusText.innerText = 'Pause';
  else if (r.mode === 'stopped') statusText.innerText = 'Arrêté';
  else if (r.mode === 'open')    statusText.innerText = 'Tiroir ouvert';
  else if (r.numTracks > 0)     statusText.innerText = 'CD prêt — ' + r.numTracks + ' pistes';
  else                           statusText.innerText = 'Aucun CD détecté';
}

function startPoll() {
  if (pollInterval) return;
  pollInterval = setInterval(poll, 1000);
  poll(); // poll immédiat
}

function stopPoll() {
  clearInterval(pollInterval);
  pollInterval = null;
}

// Changement de lecteur
driveSelect.addEventListener('change', async () => {
  stopPoll();
  resetDisplay();
  const letter = driveSelect.value.replace(':', '');
  const r = await send('set-drive', letter);
  if (r.ok) {
    statusText.innerText = 'Lecteur : ' + r.drive + ':';
    startPoll();
  }
});

document.getElementById('btn-play').addEventListener('click', async () => {
  statusText.innerText = 'Démarrage...';
  const r = await send('play');
  if (r.ok) startPoll();
});

document.getElementById('btn-pause').addEventListener('click', async () => {
  if (currentMode === 'paused') {
    await send('resume');
  } else {
    await send('pause');
    statusText.innerText = 'Pause';
  }
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  await send('stop');
  statusText.innerText  = 'Arrêté';
  timeElapsed.innerText = '0:00';
});

document.getElementById('btn-prev').addEventListener('click', async () => {
  const r = await send('prev');
  if (r.ok) { statusText.innerText = 'Piste ' + r.track; startPoll(); }
});

document.getElementById('btn-next').addEventListener('click', async () => {
  const r = await send('next');
  if (r.ok) { statusText.innerText = 'Piste ' + r.track; startPoll(); }
});

document.getElementById('btn-eject').addEventListener('click', async () => {
  stopPoll();
  statusText.innerText = 'Éjection...';
  await send('eject');
  resetDisplay();
  statusText.innerText = 'Tiroir ouvert';
});

// Volume
let volTimer = null;
volumeSlider.addEventListener('input', () => {
  const v = parseInt(volumeSlider.value);
  volumeValue.innerText = v + '%';
  clearTimeout(volTimer);
  volTimer = setTimeout(() => send('volume', v), 300);
});

// Démarrage : poll immédiat pour détecter un CD déjà présent
startPoll();
