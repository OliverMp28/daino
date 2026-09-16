// Obstáculo pasivo. No conoce ni al Dino ni al audio: el spawner le dice
// dónde está cada frame y physics.js resuelve la colisión con su hitbox.
//
// Ola 3 — dos cambios de fondo:
//   1. La posición la IMPONE el spawner desde el reloj de audio
//      (`placeAt`). Antes el obstáculo integraba `x -= speed * dt` por su
//      cuenta, lo que acumulaba deriva frente a la canción con cada tirón.
//   2. Es REUTILIZABLE. El spawner mantiene un pool por kind y los recicla con
//      `activate`/`deactivate` en vez de construir un Container + Sprite nuevo
//      por obstáculo y destruirlo al salir de pantalla. Una canción de 4 min
//      son ~250 obstáculos; con pool, unos pocos objetos vivos en total y cero
//      basura para el GC durante la partida.
//
// Kinds (config.js OBSTACLE_KIND):
//   CACTUS_SMALL — saguaro alto/angosto, apoyado en el suelo.
//   CACTUS_WIDE  — cluster de 3 cactus, bajo/ancho, apoyado en el suelo.
//   PTERO        — pterodáctilo volador (altitude > 0): se pasa agachándose.
//   CRYSTAL_*    — cristales de la antigravedad (Ola 6a), en el suelo o
//                  colgando del techo (el mismo sprite reflejado).

import { Container, Sprite } from 'pixi.js';
import { OBSTACLE_KIND, OBSTACLE_ANIM_PERIOD_S } from '../config.js';
import { getTexture, PIXEL_SCALE } from '../assets/pixelart.js';
import { obstacleHitbox, obstacleTopY } from '../systems/physics.js';

/** Duración del fundido de entrada cuando un obstáculo aparece ya dentro de pantalla. */
const FADE_IN_S = 0.18;

export class Obstacle extends Container {
    /**
     * @param {string} kind  Clave de OBSTACLE_KIND.
     */
    constructor(kind) {
        super();

        const def = OBSTACLE_KIND[kind];
        if (def === undefined) {
            // Nunca debería ocurrir: normalizeChart descarta kinds desconocidos.
            // Si llega aquí es un bug de integración, y es mejor fallar claro
            // que leer medidas de `undefined` a mitad de partida.
            throw new Error(`Obstacle: kind desconocido "${kind}".`);
        }

        this.kind = kind;
        this.def = def;
        this._frames = def.sprites;
        this._animPeriod = def.animPeriodS ?? OBSTACLE_ANIM_PERIOD_S;
        this._frameIdx = 0;
        this._flapT = 0;
        this._fadeT = FADE_IN_S;

        // Anclado a la base-centro para que el rebote al beat escale desde la
        // superficie (un cactus no despega). Lo que cuelga del techo es el mismo
        // sprite reflejado, con la base arriba. La caja lógica (x, y, w, h) no
        // cambia: el hitbox lo calcula physics.js con `def`, no con el sprite.
        this._ySign = def.surface === 'ceiling' ? -1 : 1;
        this._sprite = new Sprite(getTexture(this._frames[0]));
        this._sprite.anchor.set(0.5, 1);
        this._sprite.position.set(def.w / 2, this._ySign > 0 ? def.h : 0);
        this._sprite.scale.set(PIXEL_SCALE, PIXEL_SCALE * this._ySign);
        this.addChild(this._sprite);
        this._beat = 0;

        this.visible = false;
    }

    /**
     * Rebote al beat (Ola 5): todo el mundo late con la canción, no solo el
     * fondo. Solo visual; estira en vertical y encoge un poco en horizontal.
     * @param {number} pulse  [0,1], 1 justo en el golpe.
     */
    setBeat(pulse) {
        if (Math.abs(pulse - this._beat) < 0.01) return;
        this._beat = pulse;
        this._sprite.scale.set(PIXEL_SCALE * (1 - 0.04 * pulse), PIXEL_SCALE * (1 + 0.09 * pulse) * this._ySign);
    }

    /**
     * Pone el obstáculo en juego. Llamado por el pool al reutilizarlo.
     * @param {boolean} fadeIn  true si nace ya dentro del viewport (entrada suave).
     */
    activate(fadeIn) {
        this._frameIdx = 0;
        this._flapT = 0;
        this._sprite.texture = getTexture(this._frames[0]);
        this._fadeT = fadeIn ? 0 : FADE_IN_S;
        this.alpha = fadeIn ? 0 : 1;
        this.visible = true;
    }

    /** Lo retira de escena sin destruirlo, listo para volver al pool. */
    deactivate() {
        this.visible = false;
    }

    /**
     * @param {number} x        Borde izquierdo en coordenadas de stage.
     * @param {number} groundY  Suelo actual — se relee cada frame, así que un
     *                          resize a mitad de partida recoloca también los
     *                          obstáculos ya en pantalla (los del techo, con él).
     */
    placeAt(x, groundY) {
        this.x = x;
        this.y = obstacleTopY(this.def, groundY);
    }

    /**
     * Animación de aleteo y fundido de entrada. Solo visual.
     * @param {number} dt
     */
    animate(dt) {
        if (this._fadeT < FADE_IN_S) {
            this._fadeT = Math.min(FADE_IN_S, this._fadeT + dt);
            this.alpha = this._fadeT / FADE_IN_S;
        }
        if (this._frames.length > 1) {
            this._flapT += dt;
            if (this._flapT >= this._animPeriod) {
                this._flapT -= this._animPeriod;
                this._frameIdx = (this._frameIdx + 1) % this._frames.length;
                this._sprite.texture = getTexture(this._frames[this._frameIdx]);
            }
        }
    }

    /**
     * Rectángulo de colisión. La geometría vive en `physics.obstacleHitbox` —
     * la comparte el simulador de jugabilidad.
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    getHitbox() {
        return obstacleHitbox(this.def, this.x, this.y);
    }
}
