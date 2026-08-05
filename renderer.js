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

function fmt(sec) {
  const s = Math.floor(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function send(cmd, arg) {
  const result = await window.electronAPI.cdCommand(cmd, arg);
  if (!result.ok) statusText.innerText = 'Erreur : ' + result.error;
  return result;
}

function resetDisplay() {
  trackNum.innerText    = '--';
  trackTotal.innerText  = '--';
  timeElapsed.innerText = '0:00';
  timeTotal.innerText   = '0:00';
}

async function poll() {
  const r = await send('status');
  if (!r.ok) return;
  currentMode = r.mode;
  trackNum.innerText    = r.track || '--';
  trackTotal.innerText  = r.numTracks || '--';
  timeElapsed.innerText = fmt(r.position);
  timeTotal.innerText   = fmt(r.trackLength || 0);
  if (r.mode === 'playing')      statusText.innerText = 'Lecture en cours';
  else if (r.mode === 'paused')  statusText.innerText = 'Pause';
  else if (r.mode === 'stopped') statusText.innerText = 'Arrêté';
  else statusText.innerText = r.mode || 'En attente';
}

function startPoll() {
  if (pollInterval) return;
  pollInterval = setInterval(poll, 1000);
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
  if (r.ok) statusText.innerText = 'Lecteur changé : ' + r.drive + ':';
});

document.getElementById('btn-play').addEventListener('click', async () => {
  statusText.innerText = 'Lecture...';
  await send('play');
  startPoll();
});

document.getElementById('btn-pause').addEventListener('click', async () => {
  if (currentMode === 'paused') {
    await send('resume');
    statusText.innerText = 'Lecture...';
  } else {
    await send('pause');
    statusText.innerText = 'Pause';
  }
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  await send('stop');
  stopPoll();
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
  statusText.innerText = 'Ouverture du tiroir...';
  await send('eject');
  resetDisplay();
});

let volTimer = null;
volumeSlider.addEventListener('input', () => {
  const v = parseInt(volumeSlider.value);
  volumeValue.innerText = v + '%';
  clearTimeout(volTimer);
  volTimer = setTimeout(() => send('volume', v), 300);
});

// Init
send('volume', parseInt(volumeSlider.value));
