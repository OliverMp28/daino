// Obstáculo pasivo que se desplaza de derecha a izquierda. Lo instancia el
// Spawner desde la timeline pre-computada y lo destruye cuando sale por la
// izquierda. No conoce ni al Dino ni al audio: solo expone su hitbox AABB
// para que physics.js resuelva la colisión.
//
// Kinds (config.js OBSTACLE_KIND):
//   CACTUS_SMALL — saguaro alto/angosto, apoyado en el suelo.
//   CACTUS_WIDE  — cluster de 3 cactus, bajo/ancho, apoyado en el suelo.
//   PTERO        — pterodáctilo volador (altitude > 0): se pasa agachándose
//                  (o con un salto muy preciso). 2 frames de aleteo.

import { Container, Sprite } from 'pixi.js';
import { OBSTACLE_KIND, OBSTACLE_HITBOX_PADDING, PTERO_FLAP_PERIOD_S } from '../config.js';
import { getTexture, PIXEL_SCALE } from '../assets/pixelart.js';

export class Obstacle extends Container {
    /**
     * @param {'CACTUS_SMALL' | 'CACTUS_WIDE' | 'PTERO'} kind  Clave de OBSTACLE_KIND.
     * @param {number} spawnX   X inicial en stage coords (fuera del frame por la derecha).
     * @param {number} groundY  Y del suelo. La base del obstáculo se alinea a
     *                          groundY - altitude (altitude 0 = pisando el suelo).
     */
    constructor(kind, spawnX, groundY) {
        super();

        const data = OBSTACLE_KIND[kind];

        this.kind = kind;
        this._w = data.w;
        this._h = data.h;
        this._frames = data.sprites;
        this._frameIdx = 0;
        this._flapT = 0;

        this.x = spawnX;
        this.y = groundY - data.h - data.altitude;

        // Pívot en (0,0) — coherente con Dino: getHitbox() suma padding
        // directo a (this.x, this.y) sin compensar transform.
        this._sprite = new Sprite(getTexture(this._frames[0]));
        this._sprite.scale.set(PIXEL_SCALE);
        this.addChild(this._sprite);
    }

    /**
     * Avanza la posición X hacia la izquierda y el aleteo si hay más de un
     * frame. Pasivo: no integra física.
     * @param {number} dt         Delta time en segundos.
     * @param {number} gameSpeed  Velocidad de scroll en px/s (positivo).
     */
    update(dt, gameSpeed) {
        this.x -= gameSpeed * dt;

        if (this._frames.length > 1) {
            this._flapT += dt;
            if (this._flapT >= PTERO_FLAP_PERIOD_S) {
                this._flapT -= PTERO_FLAP_PERIOD_S;
                this._frameIdx = (this._frameIdx + 1) % this._frames.length;
                this._sprite.texture = getTexture(this._frames[this._frameIdx]);
            }
        }
    }

    /**
     * Rectángulo de colisión en stage coords con padding aplicado — las puntas
     * del sprite no cuentan como cuerpo, el hitbox queda un pelín dentro.
     * @returns {{ x: number, y: number, w: number, h: number }}
     */
    getHitbox() {
        const p = OBSTACLE_HITBOX_PADDING;
        return {
            x: this.x + p.left,
            y: this.y + p.top,
            w: this._w - p.left - p.right,
            h: this._h - p.top - p.bottom,
        };
    }

    /** True cuando el obstáculo ya no es visible. Margen de 100px para que el destroy no se note. */
    isOffscreenLeft() {
        return this.x + this._w < -100;
    }
}
