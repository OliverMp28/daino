// Constantes del game core. Único módulo donde se tocan números cuando el
// "feel" del juego necesita ajuste — HMR de este archivo recarga el módulo
// sin tirar el AudioContext ni la pestaña.
//
// Justificación de los valores: vienen del Daino legacy (juego.js:23-29, 405,
// 32, 41-42) como punto de partida que ya tenía un feel validado. El user
// puede afinar.

// --------------------------- Mundo / suelo ---------------------------

/** Píxeles desde el bottom del viewport hasta donde "pisa" el Dino. */
export const GROUND_OFFSET_PX = 22;

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
 * aquí; LevelGenerator, spawner y Obstacle lo consumen sin tocar código.
 *
 * Campos por kind:
 *   w/h            Tamaño en px (= celdas del sprite × PIXEL_SCALE).
 *   altitude       px desde el suelo hasta la BASE: 0 = apoyado (cactus);
 *                  >0 = volador (se pasa agachándose o con salto preciso).
 *   sprites        Frames de animación (1 entrada = estático).
 *   animPeriodS    Segundos por frame cuando hay >1 sprite.
 *   weight         Peso relativo en el pick del PRNG (no hace falta que
 *                  sumen 1 — se normalizan entre los kinds disponibles).
 *   availableFromS Segundos de canción antes de los cuales este kind NO
 *                  aparece (el peso se reparte entre los disponibles).
 *                  Regla determinista: misma seed ⇒ misma timeline.
 */
export const OBSTACLE_KIND = Object.freeze({
    CACTUS_SMALL: { w: 48, h: 96, altitude: 0, sprites: ['cactusSmall'], weight: 0.40, availableFromS: 0 },
    CACTUS_WIDE: { w: 100, h: 68, altitude: 0, sprites: ['cactusWide'], weight: 0.30, availableFromS: 0 },
    PTERO: { w: 96, h: 56, altitude: 58, sprites: ['pteroA', 'pteroB'], animPeriodS: 0.18, weight: 0.30, availableFromS: 10 },
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

/**
 * Tiempo mínimo y máximo entre obstáculos consecutivos en segundos. El
 * LevelGenerator descarta onsets que estén a menos de `min` del anterior
 * aceptado (para no amontonar) y rellena gaps mayores que `max` (para no
 * dejar tramos aburridos).
 */
export const SPAWN_WINDOW_S = Object.freeze({ min: 0.7, max: 1.8 });

/**
 * BPM de fallback si la autocorrelación del envelope no encuentra un pico
 * suficientemente fuerte (canciones sin pulso claro: ambient, drones, etc.).
 */
export const FALLBACK_BPM = 120;

/** Cap del deltaTime en segundos. Evita saltos al volver de background. */
export const DT_CAP_S = 1 / 30;

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
