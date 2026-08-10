const statusText   = document.getElementById('status-text');
const trackNum     = document.getElementById('track-num');
const trackTotal   = document.getElementById('track-total');
const trackTitle   = document.getElementById('track-title');
const timeElapsed  = document.getElementById('time-elapsed');
const timeTotal    = document.getElementById('time-total');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue  = document.getElementById('volume-value');
const driveSelect  = document.getElementById('drive-select');
const metaArtist   = document.getElementById('meta-artist');
const metaAlbum    = document.getElementById('meta-album');
const tracklist    = document.getElementById('tracklist');

let pollInterval  = null;
let currentMode   = '';
let lastNumTracks = 0;
let trackMeta     = []; // [{title, length}] indexed by track number (1-based, index 0 unused)

// Playback modes
// repeat: 0 = off, 1 = repeat one, 2 = repeat all
let shuffle = false;
let repeat  = 0; // 0 | 1 | 2
let shuffleOrder  = [];
let shuffleIndex  = 0;

const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat  = document.getElementById('btn-repeat');

const indShuffle   = document.getElementById('ind-shuffle');
const indRepeat1   = document.getElementById('ind-repeat1');
const indRepeatAll = document.getElementById('ind-repeatall');

function updateModeButtons() {
  btnShuffle.classList.toggle('on', shuffle);
  btnRepeat.classList.remove('on', 'on-2');

  indShuffle.classList.toggle('active', shuffle);
  indRepeat1.classList.remove('active');
  indRepeatAll.classList.remove('active');

  if (repeat === 1) {
    btnRepeat.classList.add('on');
    btnRepeat.title = 'Repeat One';
    indRepeat1.classList.add('active');
  } else if (repeat === 2) {
    btnRepeat.classList.add('on-2');
    btnRepeat.title = 'Repeat All';
    indRepeatAll.classList.add('active');
  } else {
    btnRepeat.title = 'Repeat';
  }
}

function buildShuffleOrder(numTracks, currentTrack) {
  shuffleOrder = [];
  for (let i = 1; i <= numTracks; i++) if (i !== currentTrack) shuffleOrder.push(i);
  // Fisher-Yates shuffle
  for (let i = shuffleOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
  }
  shuffleOrder.unshift(currentTrack); // current track first
  shuffleIndex = 0;
}

btnShuffle.addEventListener('click', () => {
  shuffle = !shuffle;
  if (shuffle && lastNumTracks > 0) buildShuffleOrder(lastNumTracks, parseInt(trackNum.innerText) || 1);
  updateModeButtons();
});

// Cycle: off → repeat one → repeat all → off
btnRepeat.addEventListener('click', () => {
  repeat = (repeat + 1) % 3;
  // Update icon
  if (repeat === 1) btnRepeat.querySelector('i').className = 'fa-solid fa-repeat';
  if (repeat === 2) btnRepeat.querySelector('i').className = 'fa-solid fa-repeat';
  if (repeat === 0) btnRepeat.querySelector('i').className = 'fa-solid fa-repeat';
  updateModeButtons();
});

// Called when a track ends (mode switches from playing to stopped)
async function onTrackEnd(currentTrack, numTracks) {
  if (repeat === 1) {
    // Repeat current track
    await send('play', currentTrack);
    startPoll();
    return;
  }
  if (shuffle) {
    shuffleIndex++;
    if (shuffleIndex >= shuffleOrder.length) {
      if (repeat === 2) buildShuffleOrder(numTracks, shuffleOrder[0]);
      else return; // end of shuffled playlist
    }
    const next = shuffleOrder[shuffleIndex];
    await send('play', next);
    startPoll();
    return;
  }
  // Normal sequential
  if (currentTrack < numTracks) {
    await send('play', currentTrack + 1);
    startPoll();
  } else if (repeat === 2) {
    await send('play', 1);
    startPoll();
  }
}

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
  trackTitle.innerText  = '';
  timeElapsed.innerText = '0:00';
  timeTotal.innerText   = '0:00';
  lastNumTracks = 0;
  trackMeta = [];
  metaArtist.innerText = '';
  metaAlbum.innerText  = '';
  tracklist.innerHTML  = '';
}

function buildTracklist(tracks, numTracks) {
  tracklist.innerHTML = '';
  for (let i = 1; i <= numTracks; i++) {
    const li = document.createElement('li');
    li.dataset.track = i;
    const meta = tracks[i];
    const title = meta ? meta.title : 'Track ' + i;
    const len   = meta && meta.length ? ' <span class="tl-time">' + fmt(meta.length / 1000) + '</span>' : '';
    li.innerHTML = '<span class="tl-num">' + i + '</span><span class="tl-title">' + title + '</span>' + len;
    li.addEventListener('click', () => {
      send('play', i);
      startPoll();
      highlightTrack(i);
    });
    tracklist.appendChild(li);
  }
}

function highlightTrack(n) {
  tracklist.querySelectorAll('li').forEach(li => {
    li.classList.toggle('active', parseInt(li.dataset.track) === n);
  });
}

async function lookupCD(numTracks) {
  statusText.innerText = 'Looking up CD...';
  const r = await send('lookup');
  if (!r.ok) return;
  if (!r.found) {
    statusText.innerText = 'CD not found in MusicBrainz';
    buildTracklist({}, numTracks);
    return;
  }
  metaArtist.innerText = r.artist;
  metaAlbum.innerText  = r.album + (r.date ? '  (' + r.date.slice(0, 4) + ')' : '');

  // Index tracks by number
  trackMeta = [];
  for (const t of r.tracks) {
    trackMeta[parseInt(t.number)] = t;
  }
  buildTracklist(trackMeta, numTracks);
  statusText.innerText = 'CD ready — ' + numTracks + ' tracks';
}

async function poll() {
  const r = await send('status');
  if (!r.ok) return;
  currentMode = r.mode;

  // CD inserted
  if (r.numTracks > 0 && lastNumTracks === 0) {
    await lookupCD(r.numTracks);
  }
  // CD removed
  if (r.numTracks === 0 && lastNumTracks > 0) {
    resetDisplay();
    statusText.innerText = 'No CD detected';
  }
  lastNumTracks = r.numTracks;

  trackNum.innerText    = r.numTracks > 0 ? (r.track || '--') : '--';
  trackTotal.innerText  = r.numTracks > 0 ? r.numTracks : '--';
  timeElapsed.innerText = r.position    > 0 ? fmt(r.position)    : '0:00';
  timeTotal.innerText   = r.trackLength > 0 ? fmt(r.trackLength) : '0:00';

  // Update track title from meta
  if (r.track && trackMeta[r.track]) {
    trackTitle.innerText = trackMeta[r.track].title;
  } else if (r.track) {
    trackTitle.innerText = '';
  }

  highlightTrack(r.track);
  highlightNumpad(r.track);

  // Detect track end: was playing, now stopped
  if (currentMode === 'playing' && r.mode === 'stopped' && r.numTracks > 0) {
    await onTrackEnd(r.track, r.numTracks);
    return;
  }

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
  if (currentMode === 'paused') await send('resume');
  else { await send('pause'); statusText.innerText = 'Paused'; }
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  await send('stop');
  statusText.innerText  = 'Stopped';
  timeElapsed.innerText = '0:00';
});

document.getElementById('btn-prev').addEventListener('click', async () => {
  const r = await send('prev');
  if (r.ok) { startPoll(); }
});

document.getElementById('btn-next').addEventListener('click', async () => {
  const r = await send('next');
  if (r.ok) { startPoll(); }
});

document.getElementById('btn-eject').addEventListener('click', async () => {
  stopPoll();
  statusText.innerText = 'Ejecting...';
  await send('eject');
  resetDisplay();
  statusText.innerText = 'Tray open';
});

volumeSlider.addEventListener('input', () => {
  const v = parseInt(volumeSlider.value);
  volumeValue.innerText = v + '%';
  send('volume', v);
});

updateModeButtons();

// ── Numpad ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const n = parseInt(btn.dataset.n);
    if (lastNumTracks === 0) return;
    const target = n > lastNumTracks ? lastNumTracks : n;
    await send('play', target);
    startPoll();
    highlightNumpad(target);
  });
});

function highlightNumpad(trackN) {
  document.querySelectorAll('.num-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.n) === trackN);
  });
}

startPoll();
send('volume', parseInt(volumeSlider.value));
