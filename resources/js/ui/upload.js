// Entrada de MP3 del usuario: drag & drop sobre la ventana y selector nativo.
//
// Ola 3: este módulo ya NO decodifica ni reproduce nada. Solo valida que el
// archivo parece un MP3 aceptable y pide la partida (`requestLocalPlay`).
// Decodificar, analizar (o reutilizar el análisis cacheado), generar el chart
// y arrancar la partida es trabajo de AppController + levelLoader.
//
// Antes este módulo decodificaba y EMPEZABA A REPRODUCIR la canción, y
// AppController la paraba dos líneas después para arrancarla sincronizada:
// trabajo tirado en cada partida.
//
// Validaciones (defensa de frontend; el backend revalida al publicar):
//   - MIME audio/mpeg, o nombre .mp3 (algunos sistemas no informan el tipo).
//   - Tamaño contra <meta name="daino:upload-max-mb">. Default 10 MB.

import { requestLocalPlay } from './playRequests.js';
import { unlockAudio } from '../game/audio/sharedEngine.js';
import { showToast } from './toast.js';

const META_UPLOAD_MAX = 'daino:upload-max-mb';

function readUploadMaxBytes() {
    const meta = document.querySelector(`meta[name="${META_UPLOAD_MAX}"]`);
    const mb = Number.parseInt(meta?.getAttribute('content') ?? '10', 10);
    return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

function isMp3(file) {
    if (file.type === 'audio/mpeg' || file.type === 'audio/mp3') return true;
    return /\.mp3$/i.test(file.name);
}

/** Valida y, si procede, pide la partida. */
function handleFile(file) {
    if (!isMp3(file)) {
        showToast('Solo MP3 por ahora — el archivo no parece audio/mpeg.');
        return;
    }
    const maxBytes = readUploadMaxBytes();
    if (file.size > maxBytes) {
        showToast(`Archivo demasiado grande — máximo ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
        return;
    }
    requestLocalPlay(file);
}

function onDragOver(ev) {
    ev.preventDefault();
    document.body.dataset.drag = 'active';
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(ev) {
    // dragleave también salta al pasar entre hijos; solo limpiamos al salir
    // de la ventana (relatedTarget null).
    if (ev.relatedTarget === null || ev.relatedTarget === undefined) {
        delete document.body.dataset.drag;
    }
}

function onDrop(ev) {
    ev.preventDefault();
    delete document.body.dataset.drag;
    const file = ev.dataTransfer?.files?.[0];
    if (file) handleFile(file);
}

/**
 * Abre el selector de archivos nativo y procesa el primer MP3 elegido.
 *
 * El audio se desbloquea AQUÍ, en el clic, antes de abrir el diálogo: el
 * evento `change` que llega al elegir el archivo no cuenta como gesto del
 * usuario en todos los navegadores, y sin gesto el AudioContext no arranca.
 */
export function pickFileViaInput() {
    unlockAudio();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/mpeg,.mp3';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
        const file = inp.files?.[0];
        if (file) handleFile(file);
        inp.remove();
    }, { once: true });
    inp.addEventListener('cancel', () => inp.remove(), { once: true });
    inp.click();
}

export function setupUpload() {
    document.body.addEventListener('dragover', onDragOver);
    document.body.addEventListener('dragleave', onDragLeave);
    document.body.addEventListener('drop', onDrop);
}
