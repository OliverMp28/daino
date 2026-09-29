// Scenery — el mundo alrededor del gameplay. Vive en su propia capa entre el
// shader de fondo (el cielo) y el gameLayer, y está SIEMPRE visible (menú y
// partida): el menú scrollea suave a SCENERY.menuSpeed y la partida a gameSpeed,
// así el mundo "arranca" al empezar a jugar en vez de aparecer.
//
// Desde el T01 es un COMPOSITOR: las capas (cordilleras, nubes,
// suelo…) las declara la escena (scenes/registry.js) y cada `type` tiene su
// implementación (entities/scenery/). La hora del cielo las tiñe (`light`).
//
// Sin física, sin audio, sin timeline: recibe (dt, worldSpeed) del tick del
// engine y el estado del cielo cuando cambia. Además monta el dino ambiente del
// menú, que no es parte de ninguna escena.

import { Container, Sprite } from 'pixi.js';
import { GROUND_OFFSET_PX, DINO_X, DINO_SIZE } from '../config.js';
import { getTexture, normalizeSkinId, PIXEL_SCALE } from '../assets/pixelart.js';
import { LAYER_TYPES } from './scenery/index.js';

/** Periodo fijo del trote del dino ambiente del menú (no depende del BPM). */
const AMBIENT_RUN_PERIOD_S = 0.3;

/**
 * @param {{ width: number, height: number }} viewport  Vista en unidades de mundo.
 * @param {import('../scenes/registry.js').SceneDef} scene
 */
export function createScenery(viewport, scene) {
    const container = new Container({ label: 'scenery' });

    let W = viewport.width;
    let H = viewport.height;
    let groundY = H - GROUND_OFFSET_PX;

    /** @type {Array<ReturnType<typeof LAYER_TYPES[keyof typeof LAYER_TYPES]>>} */
    let layers = [];
    /** Elementos apagados desde el panel dev: sobreviven a un cambio de escena. */
    const hidden = new Set();
    let lastState = null;

    // ---------- Dino ambiente (solo menú) ----------
    // Corre en el MISMO sitio donde la GameSession montará el Dino real: la
    // transición menú→partida se siente continua. AppController lo muestra u
    // oculta según el estado; el skin lo empuja la UI cuando cambia en AJUSTES.
    const ambientDino = new Sprite(getTexture('dinoRunA'));
    ambientDino.anchor.set(0.5, 1);
    ambientDino.scale.set(PIXEL_SCALE);
    let ambientSkin = 'classic';
    let ambientFrame = 0;
    let ambientT = 0;
    container.addChild(ambientDino);

    function layoutAmbientDino() {
        ambientDino.position.set(DINO_X + DINO_SIZE.w / 2, groundY);
    }

    /** Monta las capas de una escena (de atrás adelante, bajo el dino ambiente). */
    function build(sceneDef) {
        for (const l of layers) l.dispose();
        layers = sceneDef.layers.map((def) => {
            const create = LAYER_TYPES[def.type];
            if (!create) throw new Error(`Scenery: tipo de capa desconocido "${def.type}" en la escena "${sceneDef.id}"`);
            return create(def, { width: W, height: H, groundY });
        });
        layers.forEach((l, i) => container.addChildAt(l.container, i));
        for (const id of hidden) for (const l of layers) l.setVisible(id, false);
        if (lastState) for (const l of layers) l.light(lastState);
    }

    build(scene);
    layoutAmbientDino();

    return {
        container,

        tick(dt, worldSpeed) {
            for (let i = 0; i < layers.length; i++) layers[i].tick(dt, worldSpeed);

            // Dino ambiente: trote a periodo fijo mientras esté visible.
            if (ambientDino.visible) {
                ambientT += dt;
                if (ambientT >= AMBIENT_RUN_PERIOD_S) {
                    ambientT -= AMBIENT_RUN_PERIOD_S;
                    ambientFrame = 1 - ambientFrame;
                    ambientDino.texture = getTexture(ambientFrame === 0 ? 'dinoRunA' : 'dinoRunB', ambientSkin);
                }
            }
        },

        resize(width, height) {
            W = width;
            H = height;
            groundY = H - GROUND_OFFSET_PX;
            for (const l of layers) l.resize(W, H, groundY);
            layoutAmbientDino();
        },

        /**
         * La hora del cielo tiñe cada capa (scenes/skyModel.js).
         * @param {ReturnType<import('../scenes/skyModel.js').createSkyState>} state
         */
        light(state) {
            lastState = state;
            for (let i = 0; i < layers.length; i++) layers[i].light(state);
        },

        /** Cambia de escena: otras capas, mismo dino ambiente. */
        setScene(sceneDef) {
            build(sceneDef);
        },

        /** Enciende o apaga un elemento del escenario por su id (panel dev). */
        setElementVisible(id, on) {
            if (on) hidden.delete(id);
            else hidden.add(id);
            for (const l of layers) l.setVisible(id, on);
        },

        /** Muestra/oculta el dino ambiente (AppController: visible solo en MENU). */
        setAmbientDinoVisible(visible) {
            ambientDino.visible = visible;
            // Refresca la textura al mostrarse por si el skin cambió mientras
            // estaba oculto (partida en curso, por ejemplo).
            if (visible) ambientDino.texture = getTexture(ambientFrame === 0 ? 'dinoRunA' : 'dinoRunB', ambientSkin);
        },

        /** Cambia el skin del dino ambiente en vivo. */
        setAmbientDinoSkin(skinId) {
            ambientSkin = normalizeSkinId(skinId);
            ambientDino.texture = getTexture(ambientFrame === 0 ? 'dinoRunA' : 'dinoRunB', ambientSkin);
        },

        /**
         * (efecto, Ola 5) Pulso del beat sobre las capas que lo tienen (la línea
         * del suelo).
         * @param {number} pulse      [0,1], 1 en el golpe.
         * @param {number} intensity  [0,1] intensidad del tramo.
         */
        setPulse(pulse, intensity) {
            for (let i = 0; i < layers.length; i++) layers[i].setPulse?.(pulse, intensity);
        },
    };
}
