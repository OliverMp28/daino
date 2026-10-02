// Director de efectos (T03.1, doc 11): el único sitio donde se decide CUÁNTO se
// ve cada efecto. Los pintores no deciden nada: leen `levels[id]` ([0,1], o más si
// el panel dev sube la intensidad) y pintan.
//
// El nivel de un efecto es un producto. Cada factor lo pone quien sabe de lo suyo:
//
//   escena      su política (`scene.fx`, policy.js): qué veta, cuánto atenúa.
//   jugador     "Efectos visuales" de AJUSTES (FX_PREFS): Completos, Suaves, Mínimos.
//   equipo      el tier de calidad: el bajo no pinta los efectos caros.
//   reparto     qué efectos tiene esta canción (T03.3; hasta entonces, todos).
//   hora        `when` del efecto: el sol late si hay sol; las estrellas, de noche.
//   arco        `arc`: entra con la intensidad del tramo.
//   historia    `hush`: en un instante clave de una historia, las familias que su
//               escena diga se apartan.
//   desarrollo  el panel dev: apagar, solo, intensidad.
//
// Los cinco primeros casi nunca cambian (se recalculan al cambiar algo); los demás,
// cada fotograma, con fundido: un efecto no aparece ni desaparece de golpe.
//
// También da los colores de los efectos: los de la escena si los fija (una
// historia de autor: son parte de su paleta y no se tocan), o los de la canción,
// girados por sus cambios de tonalidad y puestos A JUEGO CON EL CIELO de la hora
// (tones.js): sobre el azul del día el rosa se va al magenta; en el ocaso rosa
// sigue siendo rosa. Un color de efecto lejos del tono de lo que tiene detrás se
// vuelve gris al mezclarse con él.
//
// Puro: mismas señales ⇒ mismos niveles. Se prueba en Node.

import { DEFAULT_FX_PREF, FX, FX_COLORS, FX_COSTS, FX_FADE, FX_FAMILIES, FX_IDS, FX_PREFS } from './registry.js';
import { sceneFxPolicy } from './policy.js';
import { harmonize } from './tones.js';

const ramp = (v, from, to) => {
    const x = (v - from) / (to - from);
    return x <= 0 ? 0 : x >= 1 ? 1 : x;
};

/** Por debajo de esto un nivel es cero: el pintor puede no pintar. */
const EPSILON = 0.004;

/**
 * Gira un color alrededor del eje gris (conserva su brillo). `turns` en vueltas.
 * La misma rotación que hacía el shader (hueShift) hasta la T03.1.
 */
export function rotateHue(rgb, turns, out) {
    const a = turns * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = 0.57735;
    const d = k * (rgb[0] + rgb[1] + rgb[2]) * (1 - ca);
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    out[0] = r * ca + k * (b - g) * sa + k * d;
    out[1] = g * ca + k * (r - b) * sa + k * d;
    out[2] = b * ca + k * (g - r) * sa + k * d;
    for (let i = 0; i < 3; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
    return out;
}

export function createFxDirector() {
    /** Niveles que leen los pintores. Objeto estable: se muta. */
    const levels = {};
    /** Nivel con su fundido, sin la intensidad del panel dev. */
    const faded = {};
    /** Factor que casi nunca cambia, y por qué es cero cuando lo es. */
    const fixed = {};
    const fixedWhy = {};
    /** Por qué el efecto no se ve AHORA (panel dev). '' si se ve. */
    const why = {};
    for (const id of FX_IDS) {
        levels[id] = 0;
        faded[id] = 0;
        fixed[id] = 0;
        fixedWhy[id] = '';
        why[id] = '';
    }

    let policy = sceneFxPolicy(null);
    let pref = FX_PREFS[DEFAULT_FX_PREF];
    let costRank = FX_COSTS.length - 1;
    /** Efectos de la canción (T03.3). null = todos. */
    let cast = null;
    let palette = FX_COLORS;
    const dev = { master: true, off: new Set(), solo: null, gain: {} };

    const colors = { warm: [...FX_COLORS.warm], cool: [...FX_COLORS.cool] };
    const hueTmp = [0, 0, 0];

    function refix() {
        for (const id of FX_IDS) {
            const def = FX[id];
            const family = FX_FAMILIES[def.family];
            let g = 1;
            let reason = '';
            if (!dev.master) { g = 0; reason = 'efectos apagados (panel dev)'; }
            else if (dev.solo !== null && dev.solo !== id) { g = 0; reason = `solo "${FX[dev.solo]?.label ?? dev.solo}" (panel dev)`; }
            else if (dev.off.has(id)) { g = 0; reason = 'apagado (panel dev)'; }
            else if (!family.fixed) {
                if (!policy.allows(id)) { g = 0; reason = 'la escena no lo permite'; }
                else if (cast !== null && family.exclusive && !cast.includes(id)) { g = 0; reason = 'no está en el reparto de la canción'; }
                else if (FX_COSTS.indexOf(def.cost) > costRank) { g = 0; reason = 'calidad gráfica'; }
                else if (pref.only !== null && !pref.only.includes(id)) { g = 0; reason = `preferencia del jugador (${pref.label})`; }
                else if (def.screen === true && !pref.screen) { g = 0; reason = `preferencia del jugador (${pref.label})`; }
                else g = policy.temperOf(def.family) * (def.base === true ? 1 : pref.gain);
            }
            fixed[id] = g;
            fixedWhy[id] = reason;
        }
    }
    refix();

    return {
        levels,
        colors,

        /**
         * Lo que casi nunca cambia. Solo las claves que se pasan.
         *
         * @param {{ scene?: object | null, pref?: string, costRank?: number, cast?: string[] | null, palette?: { warm: number[], cool: number[] } }} o
         */
        configure(o) {
            if (o.scene !== undefined) policy = sceneFxPolicy(o.scene);
            if (o.pref !== undefined) pref = FX_PREFS[o.pref] ?? FX_PREFS[DEFAULT_FX_PREF];
            if (o.costRank !== undefined) costRank = o.costRank;
            if (o.cast !== undefined) cast = o.cast;
            if (o.palette !== undefined) palette = o.palette ?? FX_COLORS;
            refix();
        },

        /**
         * Panel dev: apagar todo, apagar uno, ver uno solo, subir o bajar uno.
         * @param {{ master?: boolean, off?: Iterable<string>, solo?: string | null, gain?: Record<string, number> }} o
         */
        setOverrides(o) {
            if (o.master !== undefined) dev.master = o.master;
            if (o.off !== undefined) dev.off = new Set(o.off);
            if (o.solo !== undefined) dev.solo = o.solo;
            if (o.gain !== undefined) dev.gain = { ...o.gain };
            refix();
        },

        /**
         * Niveles y colores del fotograma.
         *
         * @param {import('./signals.js').FxSignals} s
         * @param {number} dt
         */
        update(s, dt) {
            const step = Math.max(0, dt);
            for (let i = 0; i < FX_IDS.length; i++) {
                const id = FX_IDS[i];
                const def = FX[id];
                let target = fixed[id];
                let reason = fixedWhy[id];
                if (target > 0) {
                    if (!s.playing && def.ambient !== true) { target = 0; reason = 'sin partida'; }
                    else {
                        if (def.when !== undefined) {
                            const w = def.when(s);
                            target *= w;
                            if (w <= EPSILON) reason = def.whenWhy ?? 'ahora no toca';
                        }
                        if (target > 0 && def.arc !== undefined) {
                            const a = ramp(s.song.intensity, def.arc[0], def.arc[1]);
                            target *= a;
                            if (a <= EPSILON) reason = 'el tramo es demasiado tranquilo';
                        }
                        if (target > 0 && s.hush > 0 && policy.hushes(def.family)) {
                            target *= 1 - s.hush;
                            if (s.hush >= 1 - EPSILON) reason = 'un instante de la historia';
                        }
                    }
                }
                const cur = faded[id];
                const rate = target > cur ? (def.rise ?? FX_FADE.rise) : (def.fall ?? FX_FADE.fall);
                let next = cur + (target - cur) * (1 - Math.exp(-step * rate));
                if (Math.abs(target - next) < EPSILON) next = target;
                faded[id] = next;
                levels[id] = next * (dev.gain[id] ?? 1);
                why[id] = next > EPSILON ? '' : reason;
            }

            // Colores: los de la escena, fijos; si no, los de la canción, girados
            // por sus cambios de tonalidad y a juego con el cielo que tienen detrás.
            if (policy.colors !== null) {
                for (let i = 0; i < 3; i++) {
                    colors.warm[i] = policy.colors.warm[i];
                    colors.cool[i] = policy.colors.cool[i];
                }
            } else {
                const turns = s.song.hue * levels.keyHue;
                harmonize(rotateHue(palette.warm, turns, hueTmp), s.sky.band, colors.warm);
                harmonize(rotateHue(palette.cool, turns, hueTmp), s.sky.band, colors.cool);
            }
        },

        /** Por qué un efecto no se ve ahora ('' si se ve). */
        reasonOf(id) {
            return why[id] ?? '';
        },

        /** Todo a cero sin fundido (fin de la partida: la siguiente no hereda nada). */
        reset() {
            for (const id of FX_IDS) {
                if (FX[id].ambient === true) continue;
                faded[id] = 0;
                levels[id] = 0;
            }
        },
    };
}
