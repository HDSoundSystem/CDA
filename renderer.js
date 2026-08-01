const btnEject = document.getElementById('btn-eject');
const trackInfo = document.getElementById('track-info');

btnEject.addEventListener('click', () => {
    console.log("Bouton Éjecter cliqué !");
    trackInfo.innerText = "Ouverture du tiroir...";
    
    // Appel de la fonction sécurisée définie dans le preload
    window.electronAPI.ejectCd();
});