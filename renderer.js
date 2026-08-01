const trackInfo = document.getElementById('track-info');

async function send(cmd, arg) {
  const result = await window.electronAPI.cdCommand(cmd, arg);
  if (!result.ok) {
    trackInfo.innerText = 'Erreur : ' + result.error;
  }
  return result;
}

document.getElementById('btn-play').addEventListener('click', async () => {
  trackInfo.innerText = 'Lecture...';
  await send('play');
});

document.getElementById('btn-pause').addEventListener('click', async () => {
  trackInfo.innerText = 'Pause';
  await send('pause');
});

document.getElementById('btn-stop').addEventListener('click', async () => {
  trackInfo.innerText = 'Arrêté';
  await send('stop');
});

document.getElementById('btn-eject').addEventListener('click', async () => {
  trackInfo.innerText = 'Ouverture du tiroir...';
  await send('eject', 'F'); // Change 'D' si ton lecteur CD est sur une autre lettre
});

document.getElementById('btn-prev').addEventListener('click', () => {
  trackInfo.innerText = 'Piste précédente (non implémenté)';
});

document.getElementById('btn-next').addEventListener('click', () => {
  trackInfo.innerText = 'Piste suivante (non implémenté)';
});
