// Scenery — el mundo alrededor del gameplay: suelo pixel-art que scrollea,
// nubes a la deriva y siluetas de montañas en parallax. Vive en su propia
// capa entre el shader de fondo y el gameLayer, y está SIEMPRE visible
// (menú y partida) — el menú scrollea suave a SCENERY.menuSpeed y la partida
// a gameSpeed, así el mundo "arranca" al empezar a jugar en vez de aparecer.
//
// Sin física, sin audio, sin timeline: solo recibe (dt, worldSpeed) del tick
// del engine. El engine decide worldSpeed (menú vs partida) via setWorldSpeed.

import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { GROUND_OFFSET_PX, SCENERY, DINO_X, DINO_SIZE } from '../config.js';
import { getTexture, spriteSize, normalizeSkinId, PIXEL_SCALE } from '../assets/pixelart.js';

/** Periodo fijo del trote del dino ambiente del menú (no depende del BPM). */
const AMBIENT_RUN_PERIOD_S = 0.3;

/**
 * @param {{ width: number, height: number }} viewport
 * @returns {{
 *   container: Container,
 *   tick: (dt: number, worldSpeed: number) => void,
 *   resize: (width: number, height: number) => void,
 * }}
 */
export function createScenery(viewport) {
    const container = new Container({ label: 'scenery' });

    let W = viewport.width;
    let H = viewport.height;
    let groundY = H - GROUND_OFFSET_PX;

    // ---------- Montañas lejanas (siluetas Graphics, 2 profundidades) ----------
    // Cada capa es una cresta poligonal generada 1 vez sobre 2×W y dibujada
    // dos veces seguidas (patrón periódico) — el wrap del scroll es invisible
    // porque la segunda copia empieza donde acaba la primera.
    const mountainsFar = new Graphics();
    const mountainsNear = new Graphics();

    function buildRidge(gfx, { baseRise, jag, color, step }) {
        gfx.clear();
        const period = Math.max(W, 640);
        const n = Math.ceil(period / step);
        // Cresta cerrada: heights[n] == heights[0] para que el tile sea seamless.
        const heights = [];
        for (let i = 0; i < n; i++) {
            heights.push(baseRise + Math.random() * jag);
        }
        for (let copy = 0; copy < 2; copy++) {
            const x0 = copy * period;
            gfx.moveTo(x0, 0);
            for (let i = 0; i <= n; i++) {
                const h = heights[i % n];
                gfx.lineTo(x0 + i * step, -h);
            }
            gfx.lineTo(x0 + period, 0);
            gfx.closePath();
        }
        gfx.fill(color);
        gfx._period = period; // lo usa el wrap del scroll
    }

    function buildMountains() {
        buildRidge(mountainsFar, { baseRise: 40, jag: 90, color: 0x14172e, step: 96 });
        buildRidge(mountainsNear, { baseRise: 20, jag: 60, color: 0x0e1024, step: 64 });
        mountainsFar.y = groundY + 4;   // +4: la falda queda bajo la línea del suelo
        mountainsNear.y = groundY + 4;
        mountainsFar.x = 0;
        mountainsNear.x = 0;
    }

    // ---------- Nubes ----------
    const clouds = [];

    function spawnClouds() {
        for (const c of clouds) c.destroy();
        clouds.length = 0;
        for (let i = 0; i < SCENERY.cloudCount; i++) {
            const c = new Sprite(getTexture('cloud'));
            const s = PIXEL_SCALE * (0.6 + Math.random() * 0.9);
            c.scale.set(s);
            c.alpha = 0.35 + Math.random() * 0.35;
            c.x = Math.random() * W;
            c.y = H * (0.08 + Math.random() * 0.30);
            // Deriva propia por nube — que no naveguen en formación.
            c._drift = SCENERY.cloudDriftPxS * (0.6 + Math.random() * 0.8);
            clouds.push(c);
            container.addChild(c);
        }
    }

    // ---------- Suelo ----------
    const groundTexSize = spriteSize('ground');
    const groundStrip = new TilingSprite({
        texture: getTexture('ground'),
        width: viewport.width,
        height: groundTexSize.h,
    });
    groundStrip.tileScale.set(PIXEL_SCALE);

    function layoutGround() {
        groundStrip.width = W;
        // La fila 1 del tile (la línea E) debe caer exactamente en groundY.
        // La fila 0 son los bumps que asoman por encima.
        groundStrip.y = groundY - PIXEL_SCALE;
    }

    // ---------- Dino ambiente (solo menú) ----------
    // Corre en el MISMO sitio donde la GameSession montará el Dino real —
    // la transición menú→partida se siente continua. AppController lo
    // muestra/oculta según body[data-app-state] via engine API; el skin lo
    // empuja la UI cuando cambia en AJUSTES.
    const ambientDino = new Sprite(getTexture('dinoRunA'));
    ambientDino.anchor.set(0.5, 1);
    ambientDino.scale.set(PIXEL_SCALE);
    let ambientSkin = 'classic';
    let ambientFrame = 0;
    let ambientT = 0;

    function layoutAmbientDino() {
        ambientDino.position.set(DINO_X + DINO_SIZE.w / 2, groundY);
    }

    // Orden de profundidad: montañas lejanas → cercanas → nubes → suelo → dino.
    container.addChild(mountainsFar, mountainsNear);
    // (las nubes se addChild en spawnClouds, quedan sobre las montañas)
    container.addChild(groundStrip);

    buildMountains();
    spawnClouds();
    layoutGround();
    container.setChildIndex(groundStrip, container.children.length - 1);
    container.addChild(ambientDino);
    layoutAmbientDino();

    // ---------- API ----------
    function tick(dt, worldSpeed) {
        // Suelo: 1:1 con la velocidad del mundo (los obstáculos van pegados a él).
        groundStrip.tilePosition.x -= worldSpeed * dt;

        // Montañas: parallax lento con wrap sobre su periodo.
        for (const [gfx, factor] of [
            [mountainsFar, SCENERY.mountainParallax * 0.6],
            [mountainsNear, SCENERY.mountainParallax],
        ]) {
            gfx.x -= worldSpeed * factor * dt;
            const period = gfx._period ?? W;
            if (gfx.x <= -period) gfx.x += period;
        }

        // Nubes: parallax + deriva propia; respawn por la derecha al salir.
        for (const c of clouds) {
            c.x -= (worldSpeed * SCENERY.cloudParallax + c._drift) * dt;
            if (c.x + c.width < -20) {
                c.x = W + 20 + Math.random() * 120;
                c.y = H * (0.08 + Math.random() * 0.30);
            }
        }

        // Dino ambiente: trote a periodo fijo mientras esté visible.
        if (ambientDino.visible) {
            ambientT += dt;
            if (ambientT >= AMBIENT_RUN_PERIOD_S) {
                ambientT -= AMBIENT_RUN_PERIOD_S;
                ambientFrame = 1 - ambientFrame;
                ambientDino.texture = getTexture(ambientFrame === 0 ? 'dinoRunA' : 'dinoRunB', ambientSkin);
            }
        }
    }

    function resize(width, height) {
        W = width;
        H = height;
        groundY = H - GROUND_OFFSET_PX;
        buildMountains();
        layoutGround();
        layoutAmbientDino();
        // Nubes: re-clamp de Y para que no queden fuera si el alto cambió mucho.
        for (const c of clouds) {
            if (c.y > H * 0.45) c.y = H * (0.08 + Math.random() * 0.30);
        }
    }

    /** Muestra/oculta el dino ambiente (AppController: visible solo en MENU). */
    function setAmbientDinoVisible(visible) {
        ambientDino.visible = visible;
        if (visible) {
            // Refresca la textura al mostrarse por si el skin cambió mientras
            // estaba oculto (partida en curso, por ejemplo).
            ambientDino.texture = getTexture(ambientFrame === 0 ? 'dinoRunA' : 'dinoRunB', ambientSkin);
        }
    }

    /** Cambia el skin del dino ambiente en vivo. */
    function setAmbientDinoSkin(skinId) {
        ambientSkin = normalizeSkinId(skinId);
        ambientDino.texture = getTexture(ambientFrame === 0 ? 'dinoRunA' : 'dinoRunB', ambientSkin);
    }

    return { container, tick, resize, setAmbientDinoVisible, setAmbientDinoSkin };
}
