// Registro de efectos (T03.1, doc 11): UN EFECTO ES UNA ENTRADA.
//
// Un efecto es lo que reacciona a lo que suena o a la estructura de la canción
// (doc 11 §2.4): no existe si no hay música. Aquí cada uno dice cómo se llama, a
// qué familia pertenece, en qué plano pinta, cuándo tiene sentido, cuánto cuesta y
// cómo protege lo que se juega. Cuánto se ve en cada instante lo decide el
// director (director.js); los pintores (el shader, las capas del escenario, las
// motas, las líneas, los momentos de la partida) solo leen ese nivel.
//
// Añadir un efecto = una entrada aquí + su pintor. Ni el juego, ni el charter, ni
// el chart cambian: un efecto es solo visual.
//
// FAMILIAS = HUECOS. Un nivel lleva como mucho un efecto de cada familia
// `exclusive` (un espectro, una firma): por construcción no se amontonan.
//   pulse      lo que late con el pulso; el astro que lo lleva lo elige la hora
//              (el sol de día, las estrellas de noche).
//   spectrum   lo que suena, visto: uno por escena, hecho con su paisaje.
//   signature  la firma de la canción (T03.3: aurora, lluvia de estrellas).
//   air        lo que flota: motas y líneas de velocidad.
//   moment     un instante de la estructura: drop, lift, marcha, portal.
//   tone       el color del cielo con la estructura: clímax, break, tonalidad.
//   game       pegado a lo que se juega (el rebote de los obstáculos): ni la
//              escena, ni el reparto, ni la preferencia del jugador lo tocan.
//
// PROTECCIÓN (`guard`): cómo se asegura que el efecto no tapa lo que se juega.
//   limiter    pasa por el limitador de la franja jugable (limiter.js);
//   local      un punto o un astro, como el sol y las estrellas del escenario;
//   outside    pinta fuera de la franja jugable (bajo la línea del suelo);
//   transient  dura menos de medio segundo (un destello);
//   dark       solo oscurece o apaga el color;
//   world      partículas finas que no tapan, como la lluvia;
//   game       es parte de lo que se juega.
//
// Puro y sin Pixi: lo leen el director, los pintores, el panel dev y los tests.

/** @typedef {'cheap' | 'mid' | 'heavy'} FxCost */

export const FX_FAMILIES = Object.freeze({
    pulse: Object.freeze({ label: 'Pulso', exclusive: false, fixed: false }),
    spectrum: Object.freeze({ label: 'Espectro', exclusive: true, fixed: false }),
    signature: Object.freeze({ label: 'Firma', exclusive: true, fixed: false }),
    air: Object.freeze({ label: 'Aire', exclusive: false, fixed: false }),
    moment: Object.freeze({ label: 'Momentos', exclusive: false, fixed: false }),
    tone: Object.freeze({ label: 'Tono', exclusive: false, fixed: false }),
    game: Object.freeze({ label: 'Juego', exclusive: false, fixed: true }),
});

/** De más barato a más caro: el tier de calidad dice hasta dónde se pinta (RenderProfile). */
export const FX_COSTS = Object.freeze(['cheap', 'mid', 'heavy']);

export const FX_GUARDS = Object.freeze(['limiter', 'local', 'outside', 'transient', 'dark', 'world', 'game']);

const ramp = (v, from, to) => {
    const x = (v - from) / (to - from);
    return x <= 0 ? 0 : x >= 1 ? 1 : x;
};

/**
 * @typedef {object} FxDef
 * @property {string} label          Nombre en español: el del panel dev y el de las conversaciones.
 * @property {keyof typeof FX_FAMILIES} family
 * @property {'sky' | 'scenery' | 'ground' | 'world' | 'screen' | 'game'} plane  Dónde pinta.
 * @property {FxCost} cost
 * @property {typeof FX_GUARDS[number]} guard
 * @property {boolean} [base]        Esencial: sigue con la preferencia "Mínimos" y a su fuerza con "Suaves".
 * @property {boolean} [screen]      Cambia el brillo de la pantalla entera o la mueve: fuera con "Suaves".
 * @property {boolean} [ambient]     Existe también sin partida (las motas del menú).
 * @property {[number, number]} [arc]  Entra con la intensidad del tramo: de 0 en `arc[0]` a 1 en `arc[1]`.
 * @property {(s: import('./signals.js').FxSignals) => number} [when]  [0,1]: cuánto tiene sentido ahora.
 * @property {string} [whenWhy]      Por qué no se ve cuando `when` da 0 (panel dev).
 * @property {number} [rise]         Velocidad al aparecer (1/s). Por defecto, FX_FADE.rise.
 * @property {number} [fall]         Velocidad al irse (1/s).
 */

/** Fundidos por defecto: un efecto nunca aparece ni desaparece de golpe. */
export const FX_FADE = Object.freeze({ rise: 5, fall: 2.5 });

/** @type {Record<string, FxDef>} */
export const FX = deepFreeze({
    // ---------- Pulso ----------
    groundPulse: {
        label: 'Pulso del suelo', family: 'pulse', plane: 'ground', cost: 'cheap', guard: 'outside', base: true,
    },
    sunPulse: {
        label: 'Latido del sol', family: 'pulse', plane: 'sky', cost: 'cheap', guard: 'local',
        when: (s) => s.sky.sunUp, whenWhy: 'el sol no está en el cielo',
    },
    sunGlow: {
        label: 'Resplandor del sol con los graves', family: 'pulse', plane: 'sky', cost: 'cheap', guard: 'limiter',
        when: (s) => s.sky.sunUp, whenWhy: 'el sol no está en el cielo',
    },
    starPulse: {
        label: 'Estrellas vivas', family: 'pulse', plane: 'sky', cost: 'cheap', guard: 'local',
        when: (s) => ramp(s.sky.stars, 0.02, 0.2), whenWhy: 'no hay estrellas (no es de noche)',
    },
    horizonGlow: {
        label: 'Brillo del horizonte', family: 'pulse', plane: 'sky', cost: 'cheap', guard: 'limiter',
    },
    // El cielo entero respira con el golpe. Respira HACIA ABAJO: entre golpes se
    // oscurece un poco y en el golpe vuelve a su brillo. Así se ve también de día,
    // donde no cabe sumar luz, y nunca le quita contraste a lo que se juega.
    beatPump: {
        label: 'Bombeo del cielo', family: 'pulse', plane: 'sky', cost: 'cheap', guard: 'dark', screen: true,
    },
    // El filo de luz de las crestas (el del escenario) se enciende con los graves
    // y el pulso: las montañas laten, de día y de noche. Una línea fina, como la
    // del suelo.
    ridgePulse: {
        label: 'Filo de las crestas con los graves', family: 'pulse', plane: 'scenery', cost: 'cheap', guard: 'local',
    },

    // ---------- Espectro ----------
    spectrum: {
        label: 'Espectro en el paisaje', family: 'spectrum', plane: 'scenery', cost: 'cheap', guard: 'limiter',
        // En un tramo de reposo no hay nada que enseñar: entra con el cuerpo de la canción.
        arc: [0.14, 0.42],
    },

    // ---------- Aire ----------
    motes: {
        label: 'Motas', family: 'air', plane: 'world', cost: 'cheap', guard: 'world', ambient: true,
        // Partículas sobre partículas no aportan: con lluvia o nieve, fuera.
        when: (s) => 1 - ramp(s.sky.precip, 0.12, 0.35), whenWhy: 'llueve o nieva',
        rise: 1.2, fall: 1.2,
    },
    speedLines: {
        label: 'Líneas de velocidad', family: 'air', plane: 'world', cost: 'cheap', guard: 'world', base: true,
        rise: 8, fall: 8,
    },

    // ---------- Momentos ----------
    dropFlash: {
        label: 'Destello del drop', family: 'moment', plane: 'screen', cost: 'cheap', guard: 'transient', screen: true,
        rise: 12, fall: 12,
    },
    dropKick: {
        label: 'Golpe de cámara', family: 'moment', plane: 'screen', cost: 'cheap', guard: 'transient', screen: true,
        rise: 12, fall: 12,
    },
    dropWave: {
        label: 'Ola de partículas', family: 'moment', plane: 'world', cost: 'cheap', guard: 'world',
        rise: 12, fall: 12,
    },

    // ---------- Tono ----------
    climaxTint: {
        label: 'Tinte del clímax', family: 'tone', plane: 'sky', cost: 'cheap', guard: 'limiter',
    },
    breakCalm: {
        label: 'Calma del break', family: 'tone', plane: 'sky', cost: 'cheap', guard: 'dark',
    },
    keyHue: {
        label: 'Giro de tonalidad', family: 'tone', plane: 'sky', cost: 'cheap', guard: 'dark',
    },

    // ---------- Juego ----------
    obstacleBounce: {
        label: 'Rebote al pulso', family: 'game', plane: 'game', cost: 'cheap', guard: 'game', base: true,
        rise: 12, fall: 12,
    },
});

/** Ids de los efectos, en el orden del registro (el del panel dev). */
export const FX_IDS = Object.freeze(Object.keys(FX));

/**
 * Lo que elige el jugador en AJUSTES ("Efectos visuales").
 *   gain    multiplica los efectos que no son esenciales (`base`);
 *   screen  si se permiten los que cambian la pantalla entera;
 *   only    lista cerrada: solo esos (y los de la familia `game`).
 * `prefers-reduced-motion` equivale a "Mínimos".
 */
export const FX_PREFS = deepFreeze({
    full: { label: 'Completos', gain: 1, screen: true, only: null },
    soft: { label: 'Suaves', gain: 0.55, screen: false, only: null },
    min: { label: 'Mínimos', gain: 1, screen: false, only: ['groundPulse', 'speedLines'] },
});

export const DEFAULT_FX_PREF = 'full';

/**
 * Colores de los efectos por defecto ("neón"): el rosa del pulso y el cian de los
 * agudos. Espejo de los tokens de @theme en main.css. Una escena puede fijar los
 * suyos (`scene.fx.colors`); desde la T03.3, cada canción elige su paleta.
 */
export const FX_COLORS = Object.freeze({
    warm: Object.freeze([0.88, 0.22, 0.38]),
    cool: Object.freeze([0.56, 0.88, 1.0]),
});

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}
