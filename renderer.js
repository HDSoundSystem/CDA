const statusText   = document.getElementById('status-text');
const trackNum     = document.getElementById('track-num');
const trackTotal   = document.getElementById('track-total');
const timeElapsed  = document.getElementById('time-elapsed');
const timeTotal    = document.getElementById('time-total');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue  = document.getElementById('volume-value');
const driveSelect  = document.getElementById('drive-select');

let pollInterval  = null;
let currentMode   = '';
let lastNumTracks = 0;

function fmt(sec) {
  const s = Math.floor(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function send(cmd, arg) {
  try {
    const result = await window.electronAPI.cdCommand(cmd, arg);
    if (result && !result.ok) statusText.innerText = 'Error: ' + result.error;
    return result || { ok: false };
  } catch(e) {
    statusText.innerText = 'IPC error';
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

  if (r.numTracks > 0 && lastNumTracks === 0) {
    statusText.innerText = r.numTracks + ' track(s) detected';
  }
  lastNumTracks = r.numTracks;

  trackNum.innerText    = r.numTracks > 0 ? (r.track || '--') : '--';
  trackTotal.innerText  = r.numTracks > 0 ? r.numTracks : '--';
  timeElapsed.innerText = r.position    > 0 ? fmt(r.position)    : '0:00';
  timeTotal.innerText   = r.trackLength > 0 ? fmt(r.trackLength) : '0:00';

  if      (r.mode === 'playing') statusText.innerText = 'Playing';
  else if (r.mode === 'paused')  statusText.innerText = 'Paused';
  else if (r.mode === 'stopped') statusText.innerText = 'Stopped';
  else if (r.mode === 'open')    statusText.innerText = 'Tray open';
  else if (r.numTracks > 0)     statusText.innerText = 'CD ready — ' + r.numTracks + ' tracks';
  else                           statusText.innerText = 'No CD detected';
}

function startPoll() {
  if (pollInterval) return;
  pollInterval = setInterval(poll, 1000);
  poll();
}

function stopPoll() {
  clearInterval(pollInterval);
  pollInterval = null;
}

driveSelect.addEventListener('change', async () => {
  stopPoll();
  resetDisplay();
  const letter = driveSelect.value.replace(':', '');
  const r = await send('set-drive', letter);
  if (r.ok) {
    statusText.innerText = 'Drive: ' + r.drive + ':';
    startPoll();
  }
});

document.getElementById('btn-play').addEventListener('click', async () => {
  statusText.innerText = 'Starting...';
  const r = await send('play');
  if (r.ok) startPoll();
});

document.getElementById('btn-pause').addEventListener('click', async () => {
  if (currentMode === 'paused') {
    await send('resume');
  } else {
    await send('pause');
    statusText.innerText = 'Paused';
  }
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  await send('stop');
  statusText.innerText  = 'Stopped';
  timeElapsed.innerText = '0:00';
});

document.getElementById('btn-prev').addEventListener('click', async () => {
  const r = await send('prev');
  if (r.ok) { statusText.innerText = 'Track ' + r.track; startPoll(); }
});

document.getElementById('btn-next').addEventListener('click', async () => {
  const r = await send('next');
  if (r.ok) { statusText.innerText = 'Track ' + r.track; startPoll(); }
});

document.getElementById('btn-eject').addEventListener('click', async () => {
  stopPoll();
  statusText.innerText = 'Ejecting...';
  await send('eject');
  resetDisplay();
  statusText.innerText = 'Tray open';
});

// Volume — send immediately on every input event
volumeSlider.addEventListener('input', () => {
  const v = parseInt(volumeSlider.value);
  volumeValue.innerText = v + '%';
  send('volume', v);
});

// Init
startPoll();
send('volume', parseInt(volumeSlider.value));
