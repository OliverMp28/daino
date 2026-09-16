// Entidad protagonista: el cuerpo del Dino y su visual pixel-art animado. Su X es
// fija (`DINO_X`); la Y la mueve la física (systems/physics.js) con las reglas del
// MODO DE MOVIMIENTO vigente (Ola 6: correr, antigravedad…). Aquí vive el estado
// físico (los campos de `modes/body.js`) y lo que se VE de cada gesto. Mantener la
// separación entidad/sistema: la integración NO ocurre aquí.
//
// Contrato de coordenadas: (this.x, this.y) es la esquina superior-izquierda del
// box LÓGICO DE PIE (DINO_SIZE), también agachado y cabeza abajo. Agacharse solo
// cambia el hitbox y el visual; en antigravedad el box se apoya en el techo.

import { Container, Sprite } from 'pixi.js';
import { DINO_X, DINO_SIZE, RUN_ANIM } from '../config.js';
import { getTexture, normalizeSkinId, PIXEL_SCALE } from '../assets/pixelart.js';
import { applyInput, bodyHitbox, bodyState } from '../systems/physics.js';

/** Velocidad (1/s) con la que el sprite gira hacia la gravedad nueva: ~0.1 s de volteo. */
const FLIP_VISUAL_RATE = 26;

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

        // --- Estado físico (lo leen y escriben physics.js y sus modos) ---
        Object.assign(this, bodyState(DINO_SIZE.h));
        this.x = DINO_X;
        this.y = 0;

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
        /** Orientación visual [-1, 1]: sigue a `gravityDir` con un volteo rápido. */
        this._upright = 1;
    }

    /**
     * Aplica una entrada cruda del jugador ('jump', 'jumpEnd', 'duckStart',
     * 'duckEnd') con las reglas del modo vigente y reacciona visualmente al gesto.
     * @returns {string | null} El gesto que produjo.
     */
    input(action) {
        const gesture = applyInput(this, action);
        if (gesture !== null) this.onGesture(gesture);
        return gesture;
    }

    /** Lo que se ve de cada gesto (también de uno guardado que dispara al aterrizar). */
    onGesture(gesture) {
        switch (gesture) {
            case 'jump':
                // Stretch vertical al despegar — el lerp de tickVisual lo devuelve a 1.
                this._squashX = 0.82;
                this._squashY = 1.22;
                break;
            case 'duck':
                // Squash rápido al tirarse al suelo — vende el gesto.
                this._squashX = 1.12;
                this._squashY = 0.82;
                break;
            case 'flip':
                // Se estira hacia donde cae; el volteo lo hace `_upright`.
                this._squashX = 0.86;
                this._squashY = 1.18;
                break;
            default:
                break;
        }
    }

    /** Pose de muerte (ojo en X). La llama GameSession al chocar. */
    setDead() {
        this.dead = true;
        this._sprite.texture = getTexture('dinoDead', this.skinId);
    }

    /**
     * Aterrizaje detectado por la física (BODY_EVENT.LANDED), en el suelo o en
     * el techo. Squash horizontal — se recupera solo en tickVisual.
     */
    onLand() {
        this._squashX = 1.18;
        this._squashY = 0.84;
    }

    /**
     * Avanza la animación, el volteo y el squash & stretch. La llama GameSession
     * cada frame DESPUÉS de integrar física (para leer grounded/ducking frescos).
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

        // Volteo hacia la gravedad: la escala vertical pasa por 0 (una carta que
        // gira) y los pies acaban contra la superficie de destino.
        this._upright += (this.gravityDir - this._upright) * (1 - Math.exp(-FLIP_VISUAL_RATE * dt));
        if (Math.abs(this.gravityDir - this._upright) < 1e-3) this._upright = this.gravityDir;

        // Squash & stretch converge a 1 con lerp exponencial frame-rate-independent.
        const k = 1 - Math.exp(-14 * dt);
        this._squashX += (1 - this._squashX) * k;
        this._squashY += (1 - this._squashY) * k;
        // Con el ancla en los pies, la posición recorre el box: pies abajo (1) o arriba (−1).
        this._sprite.position.y = DINO_SIZE.h * (1 + this._upright) / 2;
        this._sprite.scale.set(PIXEL_SCALE * this._squashX, PIXEL_SCALE * this._squashY * this._upright);
    }

    /**
     * Rectángulo de colisión en coordenadas del stage, según modo y postura. La
     * geometría vive en physics.js — la comparte el simulador de jugabilidad.
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    getHitbox() {
        return bodyHitbox(this);
    }
}
