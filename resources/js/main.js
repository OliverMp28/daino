// Daino — entry point del bundle.
//
// Bloque 6: el wiring del ciclo menú↔partida vive en AppController. Aquí
// solo arrancamos engine + bridge + client + UI inicial.

import 'vite/modulepreload-polyfill';
import '@css/main.css';

import { startEngine } from '@/game/engine.js';
import { setupUpload } from '@/ui/upload.js';
import { startBridge } from '@/iframe/bridge.js';
import * as client from '@/api/client.js';
import * as auth from '@/ui/auth.js';
import * as appController from '@/ui/AppController.js';
import { startPixelGrid } from '@/ui/pixel/grid.js';

let booted = false;

if (typeof window !== 'undefined') {
    window.__daino = window.__daino ?? {};
}

async function boot() {
    if (booted) return;
    booted = true;

    // La rejilla de la interfaz, antes de pintar nada: celdas enteras en píxeles de
    // pantalla a cualquier tamaño y zoom (T04).
    startPixelGrid();

    const bridgeStatus = startBridge();
    if (bridgeStatus.embedded) {
        console.info('[daino] modo iframe — bridge activo');
    }

    const mount = document.getElementById('app') ?? document.body;
    const engineApi = await startEngine(mount);

    setupUpload();

    // Hidratar identidad antes de montar la UI dependiente. Es no-bloqueante:
    // el chip arranca anónimo y se repinta cuando llega `daino:auth:login`.
    void client.init();
    const authAnchor = document.getElementById('auth-anchor');
    if (authAnchor !== null) auth.mount(authAnchor);

    // Estados MENU/LOADING/PLAYING/etc — orquesta las peticiones de partida, GameSession,
    // fadeToBlack, vuelta al menú. Sustituye la lógica que vivía aquí en B5.
    appController.start({ engine: engineApi });

    // Panel flotante de herramientas de dev (p. ej. "sin colisiones" para
    // probar un nivel entero). El `if` es una constante en build time: Vite
    // lo sustituye por `false` en producción y el bundler descarta la rama
    // entera, `import()` incluido — no pesa nada fuera de `bun run dev`.
    if (import.meta.env.DEV) {
        const { mountDevTools } = await import('@/ui/devTools.js');
        mountDevTools();
    }

    if (engineApi.reducedMotion) {
        console.info('[daino] prefers-reduced-motion: shader desactivado, fallback CSS estático');
    }

    // Debug handle. Solo state del juego — ni tokens ni PII.
    window.__daino.engine = engineApi;
    window.__daino.client = client;
    window.__daino.app = appController;
    Object.defineProperty(window.__daino, 'session', {
        get: () => appController.getActiveSession(),
        configurable: true,
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void boot(); });
} else {
    void boot();
}
