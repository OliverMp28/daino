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

/**
 * Orbe de doble salto (Ola 6c; en el código, "anillo"): un orbe en el aire que, si
 * se pulsa saltar mientras el Dino lo toca, lo vuelve a impulsar hacia arriba. Rompe el techo de densidad
 * del salto: dos saltos seguidos necesitan ≥ 0.68 s (hay que aterrizar), pero un
 * salto y su anillo caben a un contratiempo, que es donde la música los pide.
 *
 *   impulsePxS  Velocidad hacia arriba al activarse. Menos que un salto desde el
 *               suelo (900): el Dino ya va alto y un segundo salto completo lo
 *               sacaría de las pantallas más bajas (medido: ≤ 280 de altura).
 *   zonePadX/Y  El orbe se activa con esta holgura alrededor de su caja, como
 *               los orbes de Geometry Dash: se perdona el borde.
 *   leadS       El centro del aro cruza al Dino esto DESPUÉS del golpe. Pulsar
 *               pronto se guarda (jump buffer) y dispara al entrar; pulsar tarde
 *               solo vale mientras se atraviesa: así el margen queda centrado en
 *               el golpe (medido: ±130 ms a 1000 px/s, ±170 a 650).
 */
export const JUMP_RING = Object.freeze({
    impulsePxS: 760,
    zonePadX: 36,
    zonePadY: 24,
    leadS: 0.06,
});

/** Lo que se ve al activar un orbe (solo visual): chispas en su naranja. */
export const JUMP_RING_FX = Object.freeze({ color: 0xffa04d, sparks: 14 });

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
    /** Colores de las chispas de la llama (se alternan). */
    colors: Object.freeze([0xffd166, 0xff9a3c]),
    speedMin: 80,
    speedMax: 200,
    lifeS: 0.32,
    /** Chispas al encender el propulsor (empezar a mantener). */
    ignition: 7,
    /** Bocanadas de humo al apagarlo (soltar). */
    cutoff: 4,
    smokeColor: 0x5a6499,
});

/**
 * Doble salto (orbe, Ola 6c): el Dino da una voltereta hacia delante mientras
 * sube y suelta un soplo de aire bajo los pies. Es lo que cuenta "segundo salto"
 * sin leer nada. Solo visual.
 *   spinS       Duración de la vuelta completa.
 *   puff        Partículas del soplo, de qué color y a qué velocidad.
 */
export const DOUBLE_JUMP_FX = Object.freeze({
    spinS: 0.38,
    puff: Object.freeze({ count: 9, color: 0xf2f5ff, speedMin: 70, speedMax: 170, lifeS: 0.26 }),
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
 * Largos de las hileras de cactus, en celdas del arte (ver `cactusRows`;
 * pixelart.js los dibuja). La escalera llega hasta 102 celdas (408 px) porque un
 * acento tiene que seguir apretando a la velocidad máxima del juego: el margen de
 * una hilera CRECE con la velocidad (cruza antes), así que a 1000 px/s la de 328
 * px todavía perdona ±82 ms y una canción corta y rápida no podía gastar su
 * presupuesto de exigencia (Sugar Red en Extremo gastaba 0.69 de 2.94). Con
 * 348-408 px el techo baja a ±42 ms y el charter vuelve a tener con qué apretar
 * arriba; a velocidades bajas esas hileras no se eligen solas (su margen se
 * vuelve 0 y accents.js las descarta).
 */
export const CACTUS_ROW_CELLS = Object.freeze(Array.from({ length: 17 }, (_, i) => 22 + 5 * i));

/** Márgenes de adelanto de los cristales afilados, en ms (ver `sharpCrystals`). */
export const SHARP_CRYSTAL_MARGINS_MS = Object.freeze([190, 160, 130, 110]);

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
 *                    'duck'    agacharse, para los sonidos brillantes y los
 *                              contratiempos;
 *                    'flip'    invertir la gravedad (el charter alterna suelo y techo);
 *                    'accent'  variante de acento de otro kind (ver `accentOf`):
 *                              nunca se elige por papel, solo como acento.
 *   weight         Peso relativo entre kinds del MISMO papel (variedad
 *                  determinista con la seed del nivel).
 *   accentOf       Kind del que es variante de ACENTO (levels/accents.js): la
 *                  misma acción sobre un golpe fuerte, con menos margen de error.
 *                  El charter elige, entre las variantes del kind de cada acción,
 *                  la que deja el margen que pide la dificultad a la velocidad de
 *                  ese golpe. Añadir una variante = una entrada con `accentOf`.
 *   precision      true en las variantes que solo son justas a partir de cierta
 *                  velocidad (las hileras largas): no valen a cualquier velocidad
 *                  ni junto a cualquier cosa, así que las pruebas genéricas de
 *                  "todo kind se juega solo" no las incluyen.
 *   leadMarginS    Antigravedad: adelanto propio sobre lo que tarda en despejarse
 *                  (por defecto FLIP_MODE.leadMarginS). Menos adelanto = el cristal
 *                  llega antes tras el golpe y pulsar tarde deja menos margen.
 *   trigger        (Ola 6c) No es un obstáculo sino un ACTIVADOR: no se choca con
 *                  él; si el jugador pulsa mientras el Dino lo atraviesa, el modo
 *                  vigente aplica su efecto (`MovementMode.trigger`: 'jump' vuelve a
 *                  saltar en el aire). No tiene `action` propia: la pulsación la
 *                  pide el obstáculo que lo acompaña en el mismo instante.
 *   zone           Holgura del activador alrededor de su caja ({ padX, padY }).
 *   armedSprite    Dibujo del activador cuando el Dino está a su alcance y
 *                  pulsar lo activaría: enseña "ahora" (Obstacle.setArmed).
 *   hint           Cómo se explica las primeras partidas en que aparece
 *                  ({ label, keys, touch, color }).
 */
export const OBSTACLE_KIND = Object.freeze({
    CACTUS_SMALL: { w: 48, h: 96, altitude: 0, sprites: ['cactusSmall'], mode: 'run', surface: 'floor', action: 'jump', role: 'jump', weight: 1 },
    RING_JUMP: {
        w: 48, h: 104, altitude: 120, sprites: ['orbA', 'orbB'], armedSprite: 'orbLit', animPeriodS: 0.14, mode: 'run', surface: 'floor',
        trigger: 'jump', role: 'ring', actionLeadS: JUMP_RING.leadS, zone: { padX: JUMP_RING.zonePadX, padY: JUMP_RING.zonePadY }, weight: 1,
        hint: { label: 'Doble salto', keys: 'Salta y pulsa Espacio otra vez al tocar el orbe', touch: 'Salta y toca otra vez al llegar al orbe', color: 0xffa04d },
    },
    CACTUS_WIDE: { w: 100, h: 68, altitude: 0, sprites: ['cactusWide'], mode: 'run', surface: 'floor', action: 'jump', role: 'accent', accentOf: 'CACTUS_SMALL', weight: 1 },
    ...cactusRows(),
    PTERO: { w: 96, h: 56, altitude: 58, sprites: ['pteroA', 'pteroB'], animPeriodS: 0.18, mode: 'run', surface: 'floor', action: 'duck', role: 'duck', weight: 1 },
    CRYSTAL_FLOOR: { w: 52, h: 64, altitude: 0, sprites: ['crystal'], mode: 'flip', surface: 'floor', action: 'flip', role: 'flip', weight: 1 },
    CRYSTAL_CEIL: { w: 52, h: 64, altitude: 0, sprites: ['crystal'], mode: 'flip', surface: 'ceiling', action: 'flip', role: 'flip', weight: 1 },
    ...sharpCrystals(),
});

/**
 * Hileras de saguaros de 88 a 328 de largo (tras el segundo playtest de la dificultad). Un
 * cactus suelto deja ±200 ms de margen a cualquier velocidad: saltarlo es fácil
 * aunque el nivel vaya rápido. Una hilera larga obliga a clavar el salto sin
 * mover el golpe: la acción sigue en su tiempo y el margen lo decide la longitud.
 * Medido con el simulador (salto completo, cactus de 96 de alto): 208 de largo
 * deja −60/+75 ms a 600 px/s y 328 deja −70/+90 a 1000. El charter elige la
 * hilera por el margen que pide la dificultad a la velocidad de cada golpe.
 * Mismo alto que el saguaro suelto: lo que cambia la exigencia es el largo. De
 * 5 en 5 celdas (20 de mundo): a 600 px/s, 20 de largo son ~17 ms de margen por lado.
 */
function cactusRows() {
    const out = {};
    for (const cells of CACTUS_ROW_CELLS) {
        const w = cells * PIXEL_SCALE;
        out[`CACTUS_ROW_${w}`] = { w, h: 96, altitude: 0, sprites: [`cactusRow${cells}`], mode: 'run', surface: 'floor', action: 'jump', role: 'accent', accentOf: 'CACTUS_SMALL', weight: 1, precision: true };
    }
    return out;
}

/**
 * Cristales afilados de la antigravedad (tras el mismo playtest): los acentos de
 * la zona roja. Con el adelanto normal (0.24 s sobre lo que tarda en despejarse)
 * pulsar hasta ~200 ms tarde sigue salvando; uno afilado llega antes tras el golpe.
 * Medido con el simulador, tras otro cristal a un beat: 130 ms de adelanto dejan
 * +80 ms a 600 px/s y +105 a 1000; pulsar pronto sigue siendo libre (quien los
 * ve venir se adelanta sin castigo, quien sigue el golpe los clava). Del mismo
 * rosa que el ptero: peligro.
 */
function sharpCrystals() {
    const out = {};
    for (const ms of SHARP_CRYSTAL_MARGINS_MS) {
        for (const [surface, base] of [['floor', 'CRYSTAL_FLOOR'], ['ceiling', 'CRYSTAL_CEIL']]) {
            out[`${base}_SHARP_${ms}`] = { w: 52, h: 64, altitude: 0, sprites: ['crystalSharp'], mode: 'flip', surface, action: 'flip', role: 'accent', accentOf: base, weight: 1, leadMarginS: ms / 1000 };
        }
    }
    return out;
}

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

// --------------------------- Scenery ---------------------------
// Las capas del escenario (cordilleras, nubes, suelo) y sus números viven en la
// escena que las declara (scenes/registry.js, fase E1).

export const SCENERY = Object.freeze({
    /** Velocidad de scroll ambiente en px/s cuando NO hay partida (menú). */
    menuSpeed: 60,
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
