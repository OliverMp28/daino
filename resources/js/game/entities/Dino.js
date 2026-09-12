// Entidad protagonista. Salta y se AGACHA (rediseño Jul 2026 — antes solo
// salto). Su X es fija (`DINO_X`); la Y la mueve `physics.js` cada frame
// integrando gravedad y clampeando al suelo. Aquí vive el estado (vy,
// grounded, ducking, timers de coyote/buffer), el visual pixel-art animado
// y las acciones `jump()/duckStart()/duckEnd()`. Mantener separación
// entidad/sistema: la integración NO ocurre aquí.
//
// Contrato de coordenadas (igual que Bloque 5): (this.x, this.y) es la esquina
// superior-izquierda del box LÓGICO DE PIE (DINO_SIZE), también agachado —
// physics.js hace `dino.y = groundY - DINO_SIZE.h` sin excepciones. Agacharse
// solo cambia el hitbox y el visual, nunca la física vertical.

import { Container, Sprite } from 'pixi.js';
import {
    DINO_X, DINO_SIZE, DINO_HITBOX_PADDING,
    DUCK_SIZE, DUCK_HITBOX_PADDING,
    JUMP_VELOCITY, COYOTE_TIME_S, RUN_ANIM,
} from '../config.js';
import { getTexture, normalizeSkinId, PIXEL_SCALE } from '../assets/pixelart.js';

export class Dino extends Container {
    /**
     * @param {{ skinId?: string }} [opts]  Skin del registro DINO_SKINS
     *        (assets/pixelart.js). La elige el user en AJUSTES; AppController
     *        la pasa vía GameSession. Default 'classic'.
     */
    constructor(opts = {}) {
        super();

        /** Variante de paleta con la que se resuelven TODOS los frames. */
        this.skinId = normalizeSkinId(opts.skinId ?? 'classic');

        this.x = DINO_X;
        this.y = 0;

        // --- Estado físico (lo lee/escribe physics.js) ---
        this.vy = 0;
        this.grounded = true;
        /** true mientras el jugador mantiene ↓ (visual + hitbox bajos si grounded). */
        this.ducking = false;
        /** true si pulsó ↓ estando en el aire — physics aplica gravedad extra. */
        this.fastFall = false;
        /** true mientras el botón de salto sigue pulsado — soltar corta el salto. */
        this.jumpHeld = false;
        /** Segundos restantes de coyote time (se recarga en el suelo). */
        this.coyoteT = COYOTE_TIME_S;
        /** Segundos restantes del jump buffer (salto pedido justo antes de aterrizar). */
        this.jumpBufferT = 0;
        /** true tras chocar — congela la animación en la pose de muerte. */
        this.dead = false;

        // --- Visual ---
        // Sprite anclado a la BASE-CENTRO del box lógico: el squash & stretch
        // escala desde los pies (como debe ser) y el frame agachado, más ancho
        // que el box, queda centrado sin mover los pies.
        this._sprite = new Sprite(getTexture('dinoRunA', this.skinId));
        this._sprite.anchor.set(0.5, 1);
        this._sprite.position.set(DINO_SIZE.w / 2, DINO_SIZE.h);
        this._sprite.scale.set(PIXEL_SCALE);
        this.addChild(this._sprite);

        this._runT = 0;        // acumulador del ciclo de carrera
        this._runFrame = 0;    // 0 = A, 1 = B
        this._squashX = 1;     // squash & stretch actual (converge a 1)
        this._squashY = 1;
    }

    /**
     * Aplica el impulso de salto si está en el suelo o dentro del coyote time.
     * Saltar levanta al Dino aunque estuviera agachado (el salto gana).
     * @returns {boolean} true si el salto se ejecutó.
     */
    jump() {
        if (this.dead) return false;
        if (!this.grounded && this.coyoteT <= 0) return false;
        this.vy = -JUMP_VELOCITY;
        this.grounded = false;
        this.coyoteT = 0;
        this.jumpHeld = true;
        this.ducking = false;
        this.fastFall = false;
        // Stretch vertical al despegar — el lerp de tickVisual lo devuelve a 1.
        this._squashX = 0.82;
        this._squashY = 1.22;
        return true;
    }

    /** El jugador soltó el botón de salto — physics corta la subida. */
    jumpEnd() {
        this.jumpHeld = false;
    }

    /** Mantener ↓: agachado en suelo, fast-fall en el aire (y agachado al caer). */
    duckStart() {
        if (this.dead) return;
        const wasStanding = !this.ducking;
        this.ducking = true;
        if (!this.grounded) {
            this.fastFall = true;
        } else if (wasStanding) {
            // Squash rápido al tirarse al suelo — vende el gesto.
            this._squashX = 1.12;
            this._squashY = 0.82;
        }
    }

    /** Soltar ↓. */
    duckEnd() {
        this.ducking = false;
        this.fastFall = false;
    }

    /** Pose de muerte (ojo en X). La llama GameSession al chocar. */
    setDead() {
        this.dead = true;
        this._sprite.texture = getTexture('dinoDead', this.skinId);
    }

    /**
     * Aterrizaje detectado por GameSession (transición grounded false→true).
     * Squash horizontal — se recupera solo en tickVisual.
     */
    onLand() {
        this._squashX = 1.18;
        this._squashY = 0.84;
    }

    /**
     * Avanza la animación y el squash & stretch. La llama GameSession cada
     * frame DESPUÉS de integrar física (para leer grounded/ducking frescos).
     *
     * @param {number} dt         Delta en segundos.
     * @param {number} gameSpeed  px/s del scroll — escala el ciclo de carrera.
     */
    tickVisual(dt, gameSpeed) {
        if (!this.dead) {
            if (this.grounded) {
                // Ciclo de patas: más rápido cuanto más rápida la canción.
                const period = RUN_ANIM.periodS * (RUN_ANIM.refSpeed / Math.max(1, gameSpeed));
                this._runT += dt;
                if (this._runT >= period) {
                    this._runT -= period;
                    this._runFrame = 1 - this._runFrame;
                }
                if (this.ducking) {
                    this._sprite.texture = getTexture(this._runFrame === 0 ? 'dinoDuckA' : 'dinoDuckB', this.skinId);
                } else {
                    this._sprite.texture = getTexture(this._runFrame === 0 ? 'dinoRunA' : 'dinoRunB', this.skinId);
                }
            } else {
                this._sprite.texture = getTexture('dinoJump', this.skinId);
            }
        }

        // Squash & stretch converge a 1 con lerp exponencial frame-rate-independent.
        const k = 1 - Math.exp(-14 * dt);
        this._squashX += (1 - this._squashX) * k;
        this._squashY += (1 - this._squashY) * k;
        this._sprite.scale.set(PIXEL_SCALE * this._squashX, PIXEL_SCALE * this._squashY);
    }

    /**
     * Rectángulo de colisión en coordenadas del stage. Agachado EN EL SUELO
     * usa el box bajo (DUCK_SIZE anclado a los pies); en el aire o de pie usa
     * el box normal. Padding para que el hitbox perdone más que la silueta.
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    getHitbox() {
        if (this.ducking && this.grounded) {
            const p = DUCK_HITBOX_PADDING;
            const baseY = this.y + DINO_SIZE.h;             // pies (== groundY)
            const left = this.x + (DINO_SIZE.w - DUCK_SIZE.w) / 2;
            return {
                x: left + p.left,
                y: baseY - DUCK_SIZE.h + p.top,
                w: DUCK_SIZE.w - p.left - p.right,
                h: DUCK_SIZE.h - p.top - p.bottom,
            };
        }
        const p = DINO_HITBOX_PADDING;
        return {
            x: this.x + p.left,
            y: this.y + p.top,
            w: DINO_SIZE.w - p.left - p.right,
            h: DINO_SIZE.h - p.top - p.bottom,
        };
    }
}
