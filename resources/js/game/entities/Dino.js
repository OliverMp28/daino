// Entidad protagonista: el cuerpo del Dino y su visual pixel-art animado. Su X es
// fija (`DINO_X`); la Y la mueve la física (systems/physics.js) con las reglas del
// MODO DE MOVIMIENTO vigente (Ola 6: correr, antigravedad…). Aquí vive el estado
// físico (los campos de `modes/body.js`) y lo que se VE de cada gesto. Mantener la
// separación entidad/sistema: la integración NO ocurre aquí.
//
// Contrato de coordenadas: (this.x, this.y) es la esquina superior-izquierda del
// box LÓGICO DE PIE (DINO_SIZE), también agachado y cabeza abajo. Agacharse solo
// cambia el hitbox y el visual; en antigravedad el box se apoya en el techo.
//
// Montaje visual (Ola 6c): Dino → _spin (gira sobre el centro del cuerpo: la
// voltereta del doble salto) → _rig (anclado a los pies: squash, volteo de la
// antigravedad e inclinación del vuelo) → cuerpo, mochila propulsora y llama.
// En Pixi v8 un Sprite no admite hijos, de ahí los dos contenedores.

import { Container, Sprite } from 'pixi.js';
import { DINO_X, DINO_SIZE, RUN_ANIM, DOUBLE_JUMP_FX } from '../config.js';
import { getTexture, normalizeSkinId, PIXEL_SCALE } from '../assets/pixelart.js';
import { applyInput, bodyHitbox, bodyState } from '../systems/physics.js';

/** Velocidad (1/s) con la que el sprite gira hacia la gravedad nueva: ~0.1 s de volteo. */
const FLIP_VISUAL_RATE = 26;

/** Vuelo (Ola 6b): inclinación del sprite al subir y al bajar (radianes) y su velocidad (1/s). */
const FLY_TILT = Object.freeze({ climb: -0.24, dive: 0.18, rate: 16 });

/**
 * Mochila propulsora (Ola 6c): velocidad (1/s) con la que aparece al cruzar el
 * portal del vuelo y desaparece al salir, y cada cuánto parpadea la llama.
 */
const JETPACK = Object.freeze({ fadeRate: 18, flameFrameS: 0.05 });

/** Tobera en celdas del dino, respecto a sus pies (centro abajo del sprite de pie). */
const NOZZLE = Object.freeze({ x: -6, y: -9 });

export class Dino extends Container {
    /**
     * @param {{ skinId?: string, reducedMotion?: boolean }} [opts]  Skin del registro
     *        DINO_SKINS (assets/pixelart.js). La elige el user en AJUSTES; AppController
     *        la pasa vía GameSession. Default 'classic'. Con `reducedMotion` no
     *        hay voltereta en el doble salto.
     */
    constructor(opts = {}) {
        super();

        /** Variante de paleta con la que se resuelven TODOS los frames. */
        this.skinId = normalizeSkinId(opts.skinId ?? 'classic');
        this._reducedMotion = opts.reducedMotion === true;

        // --- Estado físico (lo leen y escriben physics.js y sus modos) ---
        Object.assign(this, bodyState(DINO_SIZE.h));
        this.x = DINO_X;
        this.y = 0;

        // --- Visual ---
        // _spin gira sobre el centro del box (voltereta); sin girar, no hace nada.
        this._spin = new Container();
        this._spin.position.set(DINO_SIZE.w / 2, DINO_SIZE.h / 2);
        this._spin.pivot.set(DINO_SIZE.w / 2, DINO_SIZE.h / 2);
        this.addChild(this._spin);
        // _rig va anclado a la BASE-CENTRO del box lógico: el squash & stretch
        // escala desde los pies (como debe ser) y el frame agachado, más ancho
        // que el box, queda centrado sin mover los pies. Sus capas comparten ancla,
        // así que la mochila y la llama van pegadas al cuerpo en cualquier pose.
        this._rig = new Container();
        this._rig.position.set(DINO_SIZE.w / 2, DINO_SIZE.h);
        this._rig.scale.set(PIXEL_SCALE);
        this._spin.addChild(this._rig);
        this._sprite = this._layer('dinoRunA', this.skinId);
        this._pack = this._layer('jetpack');
        this._flame = this._layer('jetFlameIdle');
        this._pack.visible = false;
        this._flame.visible = false;

        this._runT = 0;        // acumulador del ciclo de carrera
        this._runFrame = 0;    // 0 = A, 1 = B
        this._squashX = 1;     // squash & stretch actual (converge a 1)
        this._squashY = 1;
        /** Orientación visual [-1, 1]: sigue a `gravityDir` con un volteo rápido. */
        this._upright = 1;
        /** Inclinación visual en vuelo: morro arriba al subir, abajo al bajar. */
        this._tilt = 0;
        /** Cuánto se ve la mochila propulsora [0, 1]. */
        this._packK = 0;
        this._flameT = 0;
        this._flameFrame = 0;
        /** Segundos desde que empezó la voltereta del doble salto (∞ = ninguna). */
        this._spinT = Infinity;
    }

    /** Una capa del dibujo: mismo ancla (los pies) y misma rejilla que el cuerpo. */
    _layer(name, skinId) {
        const s = new Sprite(getTexture(name, skinId));
        s.anchor.set(0.5, 1);
        this._rig.addChild(s);
        return s;
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
            case 'ring':
                // Segundo impulso en el aire (orbe, Ola 6c): más marcado que un
                // salto, y una voltereta hacia delante mientras sube.
                this._squashX = 0.76;
                this._squashY = 1.3;
                if (!this._reducedMotion) this._spinT = 0;
                break;
            case 'climb':
                // Impulso al empezar a subir; la inclinación la lleva `_tilt`.
                this._squashX = 0.9;
                this._squashY = 1.12;
                break;
            default:
                break;
        }
    }

    /**
     * Pose de muerte (ojo en X), en la postura con la que chocó: es la imagen que
     * queda congelada. La llama GameSession al chocar.
     */
    setDead() {
        this.dead = true;
        const pose = !this.grounded ? 'dinoJumpDead' : this.ducking ? 'dinoDuckDead' : 'dinoDead';
        this._sprite.texture = getTexture(pose, this.skinId);
        this._endSpin();
    }

    /**
     * Posición de la tobera de la mochila en coordenadas del padre (gameLayer),
     * con la inclinación y el squash de este frame: de ahí salen la llama y el humo.
     * @param {{ x: number, y: number }} out
     */
    jetNozzle(out) {
        const sx = this._rig.scale.x * NOZZLE.x;
        const sy = this._rig.scale.y * NOZZLE.y;
        const c = Math.cos(this._rig.rotation);
        const s = Math.sin(this._rig.rotation);
        out.x = this.x + this._rig.x + sx * c - sy * s;
        out.y = this.y + this._rig.y + sx * s + sy * c;
        return out;
    }

    _endSpin() {
        this._spinT = Infinity;
        this._spin.rotation = 0;
    }

    /**
     * Aterrizaje detectado por la física (BODY_EVENT.LANDED), en el suelo o en
     * el techo. Squash horizontal — se recupera solo en tickVisual.
     */
    onLand() {
        this._squashX = 1.18;
        this._squashY = 0.84;
        this._endSpin();
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

        // En vuelo el morro sigue la dirección: sube, baja o se endereza en el
        // suelo y pegado al techo (donde la física deja vy a 0).
        const tiltTarget = this.mode === 'fly' && !this.dead
            ? (this.vy < 0 ? FLY_TILT.climb : this.vy > 0 ? FLY_TILT.dive : 0)
            : 0;
        this._tilt += (tiltTarget - this._tilt) * (1 - Math.exp(-FLY_TILT.rate * dt));
        this._rig.rotation = this._tilt;

        this._tickJetpack(dt);

        // Voltereta del doble salto: una vuelta completa hacia delante, rápida al
        // principio (el impulso) y frenando al llegar arriba.
        if (this._spinT < Infinity) {
            this._spinT += dt;
            const k = Math.min(1, this._spinT / DOUBLE_JUMP_FX.spinS);
            this._spin.rotation = 2 * Math.PI * (1 - (1 - k) ** 3);
            if (k >= 1) this._endSpin();
        }

        // Squash & stretch converge a 1 con lerp exponencial frame-rate-independent.
        const k = 1 - Math.exp(-14 * dt);
        this._squashX += (1 - this._squashX) * k;
        this._squashY += (1 - this._squashY) * k;
        // Con el ancla en los pies, la posición recorre el box: pies abajo (1) o arriba (−1).
        this._rig.position.y = DINO_SIZE.h * (1 + this._upright) / 2;
        this._rig.scale.set(PIXEL_SCALE * this._squashX, PIXEL_SCALE * this._squashY * this._upright);
    }

    /**
     * Mochila propulsora: aparece al entrar en el vuelo y se va al salir; la llama
     * parpadea mientras se mantiene y queda en brasa cuando se suelta.
     */
    _tickJetpack(dt) {
        const flying = this.mode === 'fly';
        this._packK += ((flying ? 1 : 0) - this._packK) * (1 - Math.exp(-JETPACK.fadeRate * dt));
        if (!flying && this._packK < 0.01) this._packK = 0;
        this._pack.visible = this._packK > 0;
        this._pack.alpha = this._packK;
        // Sin empuje ni mochila, sin llama. Muerto, tampoco.
        this._flame.visible = this._pack.visible && !this.dead;
        if (!this._flame.visible) return;
        this._flame.alpha = this._packK;
        if (flying && this.flyHeld > 0) {
            this._flameT += dt;
            if (this._flameT >= JETPACK.flameFrameS) {
                this._flameT = 0;
                this._flameFrame = 1 - this._flameFrame;
            }
            this._flame.texture = getTexture(this._flameFrame === 0 ? 'jetFlameA' : 'jetFlameB');
        } else {
            this._flame.texture = getTexture('jetFlameIdle');
        }
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
