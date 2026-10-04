// Daino — entry point del bundle.
//
// Bloque 6: el wiring del ciclo menú↔partida vive en AppController. Aquí
// solo arrancamos engine + bridge + client + UI inicial.

import 'vite/modulepreload-polyfill';
import '@css/main.css';

import { startEngine } from '@/game/engine.js';
import { setupUpload } from '@/ui/upload.js';
import { readDebugFlag, startBridge } from '@/iframe/bridge.js';
import * as client from '@/api/client.js';
import * as auth from '@/ui/auth.js';
import * as appController from '@/ui/AppController.js';
import { startPixelGrid } from '@/ui/pixel/grid.js';
import { showToast } from '@/ui/toast.js';

let booted = false;

if (typeof window !== 'undefined') {
    window.__daino = window.__daino ?? {};
}

async function boot() {
    if (booted) return;
    booted = true;

    // Dentro del portal de Vout, lo primero es decirle que estamos (READY): significa
    // "puedo recibir la identidad", no "ya lo cargué todo". Sale antes de montar
    // nada, y antes del evento `load` de la página, desde el que el portal cuenta
    // sus 8 segundos para dar el juego por colgado.
    const voutDebug = readDebugFlag();
    const bridgeStatus = startBridge({ debug: voutDebug });
    if (bridgeStatus.embedded) {
        console.info('[daino] modo iframe — bridge activo');
        // El mando del control facial (teclas, clics y gestos que el portal
        // retransmite) solo existe aquí dentro: no pesa a quien juega por su cuenta.
        void import('@/iframe/remote.js').then(({ startRemote }) => startRemote());
        if (voutDebug) void import('@/ui/voutDebug.js').then(({ mountVoutDebug }) => mountVoutDebug());
    }

    // La rejilla de la interfaz, antes de pintar nada: celdas enteras en píxeles de
    // pantalla a cualquier tamaño y zoom (T04).
    startPixelGrid();

    // Quién mira se pregunta YA, mientras arranca el motor (un segundo largo): al
    // montar la interfaz lo normal es saberlo, y un enlace a «Míos» o a un nivel
    // propio se abre sin esperar otra petición (T06). No bloquea: si tarda, el
    // chip arranca anónimo y se repinta cuando llega `daino:auth:login`.
    void client.init();

    const mount = document.getElementById('app') ?? document.body;
    const engineApi = await startEngine(mount);

    setupUpload();

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

    // Lectura de rendimiento en pantalla (T05.4): solo con `?perf=1`, y en su
    // propio chunk. Para probar en un móvil, donde no hay consola a mano.
    const params = new URLSearchParams(window.location.search);
    if (params.get('perf') === '1') {
        const { mountPerfReadout } = await import('@/ui/perfReadout.js');
        mountPerfReadout(engineApi);
    }

    // `?voutdebug=1` abierto por su cuenta solo deja la depuración encendida para
    // cuando Daino se abra desde el portal (que lo carga sin parámetros): se dice.
    if (!bridgeStatus.embedded && params.has('voutdebug')) {
        showToast(voutDebug
            ? 'Depuración de Vout encendida. Abre Daino desde el portal de Vout para verla.'
            : 'Depuración de Vout apagada.', 'info', 7000);
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
