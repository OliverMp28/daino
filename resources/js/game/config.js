// Constantes del game core. Único módulo donde se tocan números cuando el
// "feel" del juego necesita ajuste — HMR de este archivo recarga el módulo
// sin tirar el AudioContext ni la pestaña.
//
// Justificación de los valores: vienen del Daino legacy (juego.js:23-29, 405,
// 32, 41-42) como punto de partida que ya tenía un feel validado. El user
// puede afinar.

// --------------------------- Mundo / suelo ---------------------------

/**
 * Unidades de mundo desde el borde inferior de la vista hasta donde "pisa" el
 * Dino. Todas las medidas del juego (tamaños, alturas, px/s) están en unidades
 * de mundo; la pantalla las multiplica por la escala de la vista (WORLD_VIEW).
 */
export const GROUND_OFFSET_PX = 22;

/** Unidades de mundo por celda del arte pixel (assets/pixelart.js). */
export const PIXEL_SCALE = 4;

/**
 * Cuánto mundo se ve (tamaños de pantalla, Sep 2026).
 *
 * Antes el mundo se dibujaba a 1 unidad = 1 px CSS: un monitor ancho veía más
 * mundo, no uno más grande. En 1920 px un obstáculo aparecía 3 s antes de
 * llegar y la velocidad se diluía; en un móvil vertical, 0.4 s antes; y en un
 * 4K el juego era una franja diminuta al pie de un cielo vacío. Ahora la vista
 * se escala para enseñar el MISMO mundo en cualquier pantalla apaisada, con el
 * píxel del arte entero en píxeles de dispositivo (nunca emborronado).
 *
 *   targetHeight  Alto de mundo que se quiere ver. Fija la escala en casi todas
 *                 las pantallas (16:9 → ~1100 × 620 de mundo).
 *   minWidth      Ancho mínimo visible: lo que se lee por delante del Dino a la
 *                 velocidad máxima del charter (SPEED_RULES.maxSpeedPxS) nunca
 *                 baja de ~1.2 s. Manda en pantallas estrechas (4:3, vertical).
 *   maxWidth      Ancho máximo: en una ultrapanorámica se amplía aunque se vea
 *                 menos alto, para no volver a diluir la velocidad.
 *   minHeight     Alto mínimo: salto completo, ptero y HUD caben siempre.
 */
export const WORLD_VIEW = Object.freeze({
    targetHeight: 620,
    minWidth: 1000,
    maxWidth: 1600,
    minHeight: 420,
});

/**
 * Vista del MENÚ en una pantalla vertical. Ahí no se juega (el dino trota de
 * adorno) y el ancho mínimo de partida lo dejaba en 21 px al pie de la pantalla;
 * con este mínimo se ve al tamaño de un móvil apaisado. En horizontal el menú
 * usa WORLD_VIEW: la escena no cambia de escala al empezar a jugar.
 */
export const WORLD_VIEW_PORTRAIT_MENU = Object.freeze({ ...WORLD_VIEW, minWidth: 520 });

/** Aceleración hacia abajo en px/s² aplicada al Dino mientras está en el aire. */
export const GRAVITY = 2500;

/** Velocidad inicial (negativa = hacia arriba) que toma el Dino al saltar. */
export const JUMP_VELOCITY = 900;

// --------------------------- Dino ---------------------------

/** Tamaño del box lógico del Dino de pie en px (21×21 celdas × PIXEL_SCALE 4). */
export const DINO_SIZE = { w: 84, h: 84 };

/** X fija en pantalla donde vive el Dino (no se mueve horizontalmente). */
export const DINO_X = 120;

/**
 * Padding del hitbox respecto a los bordes del box visual. Generoso
 * a la derecha (legacy 30px) — hace al juego más "perdonador" cuando el
 * Dino aterriza tarde sobre un cactus pequeño.
 */
export const DINO_HITBOX_PADDING = { top: 10, right: 30, bottom: 15, left: 20 };

/**
 * Box lógico del Dino AGACHADO (26×12 celdas × 4). Más ancho y mucho más
 * bajo que de pie — pasa por debajo del ptero. El box se ancla a la base
 * del box de pie (los pies no se mueven), centrado horizontalmente.
 */
export const DUCK_SIZE = { w: 104, h: 48 };

/** Padding del hitbox agachado. La cola/cabeza sobresalen y no cuentan. */
export const DUCK_HITBOX_PADDING = { top: 6, right: 30, bottom: 0, left: 16 };

// --------------------------- Feel del salto ---------------------------
// Estándar de plataformas: el salto responde a CUÁNTO mantienes pulsado y
// perdona imprecisiones de unos pocos frames. Todo determinista (timers en
// segundos de juego, no wall-clock).

/**
 * Multiplicador de gravedad mientras el Dino SUBE y el jugador ya soltó el
 * botón — corta el salto antes. Soltar rápido = salto corto, mantener =
 * salto completo.
 */
export const JUMP_CUT_MULTIPLIER = 2.6;

/**
 * Multiplicador de gravedad cuando el jugador pulsa ↓ en el aire (fast-fall,
 * como el Chrome dino). Permite aterrizar antes para encadenar el siguiente
 * salto al ritmo.
 */
export const FAST_FALL_MULTIPLIER = 2.4;

/** Ventana tras dejar el suelo en la que el salto todavía cuenta (coyote time). */
export const COYOTE_TIME_S = 0.09;

/** Si pulsas saltar un pelín antes de aterrizar, el salto se guarda y dispara al tocar suelo. */
export const JUMP_BUFFER_S = 0.12;

// --------------------------- Modos de movimiento (Ola 6) ---------------------------
// Cada modo cambia las reglas del cuerpo durante un tramo de la canción y entra y
// sale por un portal (systems/modes/). Correr (salto + agacharse) es el de siempre.

/**
 * Alto del pasillo de los modos con techo (antigravedad, vuelo): del suelo a la
 * superficie del techo, en unidades de mundo. Con el alto mínimo de la vista
 * (WORLD_VIEW.minHeight) el techo y su franja caben bajo el HUD.
 */
export const CORRIDOR_HEIGHT_PX = 300;

/**
 * Antigravedad: un pasillo con techo; cualquier pulsación invierte la gravedad
 * y el Dino cae hacia la otra superficie. Los cristales del suelo obligan a
 * subir y los del techo a bajar.
 *
 *   gravity         Aceleración hacia la superficie de destino (px/s²).
 *   kickPxS         Velocidad inicial al invertir: despega en seco en vez de
 *                   quedarse pegado a la superficie los primeros frames.
 *   maxSpeedPxS     Tope de velocidad vertical.
 *   leadMarginS     Adelanto del chart más allá de lo que tarda en despejar un
 *                   cristal (ver modes/flip.js: `leadS`).
 */
export const FLIP_MODE = Object.freeze({
    gravity: 5200,
    kickPxS: 450,
    maxSpeedPxS: 1500,
    leadMarginS: 0.24,
});

/**
 * Vuelo (Ola 6b): mientras se mantiene pulsado el Dino sube; al soltar, baja.
 * Siempre en línea recta y a velocidad fija: el camino que dibuja es exactamente
 * el ritmo de las pulsaciones, como las notas mantenidas de un juego de ritmo, y
 * un error de N ms desvía el Dino N ms × velocidad (el túnel lo tiene en cuenta).
 *
 *   climbPxS   Velocidad de subida (unidades de mundo por segundo).
 *   divePxS    Velocidad de bajada.
 *   baseMarginPx  Holgura fija del túnel, además del error de tiempo de la dificultad.
 */
export const FLY_MODE = Object.freeze({
    climbPxS: 300,
    divePxS: 300,
    baseMarginPx: 10,
    /**
     * Boca del túnel: segundos tras el portal sin muros. El Dino puede cruzarlo
     * al final de un salto (hasta ~130 de altura con un salto tardío) y baja a
     * `divePxS`; los muros empiezan cuando ya está en el suelo.
     */
    entryOpenS: 0.5,
});

/** Color de cada modo: su portal, su franja en el mapa de la canción y su aviso. */
export const MODE_COLORS = Object.freeze({ run: 0x7fe6ff, flip: 0xc08bff, fly: 0xffd166 });

/**
 * Lo que rodea a un cambio de modo en la partida (solo visual).
 *   warnBeats/warnMinS  Cuándo empieza el aviso del HUD antes del portal.
 *   strength            Fuerza del momento al cruzarlo (ver DROP_FX).
 *   hintRuns            Partidas con este modo en las que se explican sus controles.
 *   linesClearPx        Franja sobre el suelo sin líneas de velocidad mientras el
 *                       pasillo está en pantalla (una raya dentro se leería como obstáculo).
 */
export const MODE_FX = Object.freeze({
    warnBeats: 8,
    warnMinS: 2.5,
    strength: 0.7,
    hintRuns: 3,
    linesClearPx: 360,
});

/**
 * Propulsión del vuelo (Ola 6b): mientras se mantiene, chispas en el oro del modo
 * saliendo de la cola del Dino hacia atrás y abajo. Una cada `periodS`.
 */
export const FLY_JET = Object.freeze({
    periodS: 0.04,
    color: 0xffd166,
    speedMin: 80,
    speedMax: 200,
    lifeS: 0.32,
});

// --------------------------- Animación ---------------------------

/**
 * Periodo del ciclo de carrera (alternancia de patas) a la velocidad de
 * referencia. Se escala inversamente con gameSpeed: a más velocidad, las
 * patas alternan más rápido.
 */
export const RUN_ANIM = Object.freeze({ periodS: 0.16, refSpeed: 400 });

/** Periodo default de animación de obstáculos multi-frame sin `animPeriodS` propio. */
export const OBSTACLE_ANIM_PERIOD_S = 0.18;

/** Polvo al correr: cada cuántos segundos suelta una motita en los pies. */
export const RUN_DUST = Object.freeze({ periodS: 0.24, color: 0x5a6499 });

/**
 * Techo global de partículas one-shot vivas (bursts). Si se alcanza, los
 * bursts nuevos se descartan — protege dispositivos modestos de una cascada
 * de muertes/aterrizajes seguidos.
 */
export const MAX_BURST_PARTICLES = 140;

// --------------------------- Obstáculos ---------------------------

/**
 * Catálogo de tipos de obstáculo — REGISTRO ÚNICO Y EXTENSIBLE. Añadir un
 * obstáculo nuevo = dibujar su sprite en assets/pixelart.js + una entrada
 * aquí; el charter, el spawner y Obstacle lo consumen sin tocar código.
 *
 * Campos por kind:
 *   w/h            Tamaño en px (= celdas del sprite × PIXEL_SCALE).
 *   altitude       px desde el suelo hasta la BASE: 0 = apoyado (cactus);
 *                  >0 = volador (se pasa agachándose o con salto preciso).
 *   sprites        Frames de animación (1 entrada = estático).
 *   animPeriodS    Segundos por frame cuando hay >1 sprite.
 *   mode           Modo de movimiento en el que existe (Ola 6): 'run' o 'flip'.
 *   surface        'floor' (se apoya en el suelo) o 'ceiling' (cuelga del techo
 *                  del modo; altitude se mide desde el techo hacia abajo).
 *   action         Qué hace el jugador para superarlo: 'jump', 'duck' o 'flip'.
 *   role           Papel musical en el charter (Ola 5):
 *                    'jump'    salto normal, un golpe del pulso;
 *                    'accent'  salto que exige precisión, reservado a los
 *                              golpes fuertes (primer tiempo, drops);
 *                    'duck'    agacharse, para los sonidos brillantes y los
 *                              contratiempos;
 *                    'flip'    invertir la gravedad (el charter alterna suelo y techo).
 *   weight         Peso relativo entre kinds del MISMO papel (variedad
 *                  determinista con la seed del nivel).
 */
export const OBSTACLE_KIND = Object.freeze({
    CACTUS_SMALL: { w: 48, h: 96, altitude: 0, sprites: ['cactusSmall'], mode: 'run', surface: 'floor', action: 'jump', role: 'jump', weight: 1 },
    CACTUS_WIDE: { w: 100, h: 68, altitude: 0, sprites: ['cactusWide'], mode: 'run', surface: 'floor', action: 'jump', role: 'accent', weight: 1 },
    PTERO: { w: 96, h: 56, altitude: 58, sprites: ['pteroA', 'pteroB'], animPeriodS: 0.18, mode: 'run', surface: 'floor', action: 'duck', role: 'duck', weight: 1 },
    CRYSTAL_FLOOR: { w: 52, h: 64, altitude: 0, sprites: ['crystal'], mode: 'flip', surface: 'floor', action: 'flip', role: 'flip', weight: 1 },
    CRYSTAL_CEIL: { w: 52, h: 64, altitude: 0, sprites: ['crystal'], mode: 'flip', surface: 'ceiling', action: 'flip', role: 'flip', weight: 1 },
});

/** Padding del hitbox del obstacle (más ajustado que el del Dino). */
export const OBSTACLE_HITBOX_PADDING = { top: 6, right: 6, bottom: 4, left: 6 };

// --------------------------- Velocidad por BPM ---------------------------

/**
 * Mapeo BPM → velocidad de scroll. Lineal entre los anclajes con clamp en
 * los extremos. Evita que canciones a 200 BPM se vuelvan injugables o que
 * canciones lentas se sientan estancadas.
 */
export const SPEED_BY_BPM = Object.freeze({
    /** BPM ancla bajo. */
    bpmLow: 60,
    /** Velocidad scroll en px/s para `bpmLow`. */
    speedLow: 300,
    /** BPM ancla alto. */
    bpmHigh: 180,
    /** Velocidad scroll en px/s para `bpmHigh`. */
    speedHigh: 540,
    /** Clamp inferior (px/s). */
    min: 250,
    /** Clamp superior (px/s). */
    max: 600,
});

/** Devuelve la velocidad de scroll en px/s para un BPM dado, clamped. */
export function speedFromBpm(bpm) {
    const { bpmLow, speedLow, bpmHigh, speedHigh, min, max } = SPEED_BY_BPM;
    const t = (bpm - bpmLow) / (bpmHigh - bpmLow);
    const speed = speedLow + t * (speedHigh - speedLow);
    return Math.max(min, Math.min(max, speed));
}

// --------------------------- Generación de nivel ---------------------------
//
// Los huecos entre obstáculos ya no son constantes de aquí (el antiguo
// SPAWN_WINDOW_S de 0.7-1.8 s, defecto D14): desde la Ola 5 el charter los
// deriva de la física para cada par de acciones, a la velocidad de ese tramo y
// con la tolerancia de la dificultad (levels/patterns.js, PAIR_GAP), y la
// densidad sale del arco de la canción (levels/difficulty.js).

/**
 * BPM de fallback si la autocorrelación del envelope no encuentra un pico
 * suficientemente fuerte (canciones sin pulso claro: ambient, drones, etc.).
 */
export const FALLBACK_BPM = 120;

/** Cap del deltaTime en segundos para lo VISUAL (animaciones, partículas, sacudida). */
export const DT_CAP_S = 1 / 30;

/**
 * Paso fijo de la física del Dino (Ola 3). La física avanza en pasos de este
 * tamaño hasta alcanzar el reloj de la canción, sin importar cuánto dure cada
 * frame (patrón "fixed timestep").
 *
 * Por qué: los obstáculos se colocan desde el reloj de audio, que avanza en
 * tiempo real. Si la física integrara con el delta del frame capado, un tirón
 * de 160 ms haría avanzar la canción 160 ms pero el salto solo 33 ms: el Dino
 * quedaría atrás del mundo y un jugador que pulsó a tiempo chocaría. Medido en
 * navegador con la máquina cargada. Con paso fijo, física y música no se
 * separan nunca.
 *
 * Es además el mismo paso que usa el simulador de jugabilidad
 * (playability.js): lo que valida el charter es exactamente lo que se juega.
 */
export const PHYSICS_STEP_S = 1 / 120;

/**
 * Máximo tiempo de física a recuperar en un solo frame.
 *
 * Por debajo de esto, la física SIEMPRE alcanza a la música aunque el frame
 * haya durado mucho: es barato (cada paso cuesta ~0.5 µs; 5 s son 600 pasos,
 * ~0.3 ms) y es lo único que mantiene al Dino sincronizado. Un tope menor
 * descartaría física en frames lentos pero legítimos — medido: con la pestaña
 * estrangulada a 1 FPS y un tope de 0.5 s, se perdía medio segundo de salto
 * por frame mientras los obstáculos seguían la canción.
 *
 * Solo por encima (depurador en pausa, suspensión del equipo) se descarta el
 * exceso: a esas alturas la partida está perdida de todos modos, y no tiene
 * sentido simular minutos de golpe.
 */
export const MAX_PHYSICS_CATCHUP_S = 5;

// --------------------------- Scenery (parallax) ---------------------------

export const SCENERY = Object.freeze({
    /** Velocidad de scroll ambiente en px/s cuando NO hay partida (menú). */
    menuSpeed: 60,
    /** Factor de parallax de las nubes respecto a la velocidad del mundo. */
    cloudParallax: 0.25,
    /** Deriva propia de las nubes en px/s (se mueven aunque el mundo pare). */
    cloudDriftPxS: 8,
    /** Factor de parallax de las montañas lejanas. */
    mountainParallax: 0.12,
    /** Número de nubes en pantalla. */
    cloudCount: 4,
});

// --------------------------- Juice ---------------------------

/** Screen shake al morir: duración total y magnitud inicial en px. */
export const SHAKE = Object.freeze({ durationS: 0.35, magnitudePx: 14 });

/** Congelación breve del mundo en el frame del impacto (hit-stop). */
export const HITSTOP_S = 0.09;

/** Flash blanco al morir: alpha inicial y duración del fade. */
export const DEATH_FLASH = Object.freeze({ alpha: 0.45, durationS: 0.28 });

/**
 * Drop (Ola 5): al entrar en un tramo mucho más intenso. Destello aditivo de
 * pantalla completa, golpe de cámara hacia abajo y ola de partículas por el
 * suelo, todo en unas décimas. Con `prefers-reduced-motion` solo se aviva el
 * fondo, sin destello ni golpe.
 */
export const DROP_FX = Object.freeze({
    flashS: 0.42,
    overlayAlpha: 0.16,
    overlayColor: 0xbfe9ff,
    kickPx: 6,
    kickS: 0.18,
    waveBursts: 6,
    /** Un "lift" (subir un nivel hacia el empuje): fondo al 50 %, sin destello ni golpe. */
    liftStrength: 0.5,
});

/**
 * Pulsar sobre el golpe (Ola 5): margen para reconocer que una pulsación cae
 * en el instante de acción de un obstáculo, y color del destello.
 */
export const ON_BEAT = Object.freeze({ windowS: 0.06, color: 0x8fe0ff });

/**
 * Líneas de velocidad (afinado de velocidad, Sep 2026). Rayas de luz que cruzan
 * el cielo más rápido que el suelo cuando el nivel va por encima de su velocidad
 * de arranque (systems/speedCues.js decide cuántas), con una ráfaga en cada
 * acelerón. Solo visual: no tocan la jugabilidad ni la sincronía. Con
 * `prefers-reduced-motion` no existen.
 */
export const SPEED_LINES = Object.freeze({
    count: 26,
    /** Rayas extra de la ráfaga de un acelerón (cruzan toda la pantalla de golpe). */
    burst: 14,
    /** Velocidad de cada raya respecto a la del mundo: aire en primer plano. */
    speedFactor: Object.freeze([1.7, 2.8]),
    /** Largo en px con intensidad 0 y 1 (cada raya varía ±40 %). */
    lengthPx: Object.freeze([46, 170]),
    thicknessPx: 2,
    /** Alpha con intensidad 0 y 1 (mezcla aditiva). */
    alpha: Object.freeze([0.12, 0.34]),
    /**
     * Franja libre sobre el suelo: el Dino salta hasta ~160 px y el ptero vuela
     * a ~115 px. Una raya ahí se confundiría con un obstáculo.
     */
    clearAboveGroundPx: 200,
    /** Primera fracción de la altura sin rayas (la ocupa el HUD). */
    topFraction: 0.16,
    /** Fundido del conjunto al aparecer y al irse (1/s). */
    fadeRate: 5,
    colors: Object.freeze([0x8fe0ff, 0xf2f5ff, 0xff5d7e]),
});

/**
 * Marchas (afinado de velocidad).
 *   strength    En el primer tiempo que motiva un acelerón que no coincide con
 *               un drop ni un lift, un momento más discreto que ellos (ola de
 *               partículas por el suelo y fondo avivado, sin golpe de cámara).
 *   riserPulse  En los compases previos a un acelerón, el suelo y el fondo
 *               laten también a contratiempo, cada vez más fuerte (hasta este
 *               pulso): una subida que avisa sin palabras.
 */
export const GEAR_FX = Object.freeze({ strength: 0.4, riserPulse: 0.75 });

/** Partículas ambientales (capa 2): cuántas y rango de velocidad base px/s. */
export const AMBIENT_PARTICLES = Object.freeze({ count: 80, minSpeed: 8, maxSpeed: 26 });

// --------------------------- HUD ---------------------------

export const HUD = Object.freeze({
    fontName: 'DainoHud',
    fontSize: 32,
    fontColor: 0xffffff,
    /** Caracteres precompilados para BitmapFont.install. */
    chars: '0123456789 :./-%SCOREgameovrtryain',
    /** Padding desde el borde del viewport. */
    padding: 24,
});
