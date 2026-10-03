// El búfer del cielo (T05.1): el shader del fondo se pinta en una textura propia,
// a los texeles que diga la rejilla (systems/skyGrid.js), y la escena enseña esa
// textura ampliada sin suavizar.
//
// Por qué
// -------
// El cielo se calcula píxel a píxel y era el 94 % del trabajo de la gráfica en un
// fotograma (7,5 ms de 8 en una Intel UHD 620 a 1080p; en 4K, 24-33 FPS). Era un
// Filter de Pixi sobre un sprite a pantalla completa, y `filter.resolution` no lo
// abarataba: un filtro solo se pinta directo en la superficie de destino, a su
// resolución, y esa propiedad solo cambia la textura de ENTRADA, que este shader
// no lee (medido: a 0.25 costaba lo mismo).
//
// Cómo
// ----
//   - A menos píxeles: N texeles por celda del arte, alineados con las celdas
//     (ver systems/skyGrid.js).
//   - Repartido en el tiempo: el cielo no se desplaza con el mundo, así que no
//     necesita una imagen nueva en cada fotograma. Cada imagen se pinta en k
//     fotogramas —una BANDA horizontal en cada uno— sobre una textura de trabajo
//     que no se ve, con el estado del cielo del primero de ellos; cuando está
//     entera, se copia a la que se enseña. Así todos los fotogramas cuestan lo
//     mismo (la k-ésima parte del cielo) y lo que se ve es siempre una imagen
//     completa de un solo instante.
//   - Sin pasar por la escena de Pixi: la banda es un rectángulo pintado a mano
//     con el shader (`renderer.encoder.draw`). Una llamada a `renderer.render()`
//     por fotograma solo para esto costaba medio milisegundo de JS: lo que más
//     falta le hace a un móvil.
//
// Lo que se probó antes y no valió (para no volver a ello):
//   - Repintar el cielo entero un fotograma sí y otro no: de media costaba la
//     mitad, pero la gráfica baja su reloj cuando la carga media baja y el
//     fotograma caro tardaba más que antes (de 8 ms a 13-15).
//   - Enseñar las bandas según se pintan: en un cambio brusco (el golpe del
//     bombeo) una banda se entera un fotograma antes: una raya a media pantalla.
//   - Filas alternas (entrelazado): lo que se mueve con el borde nítido (el filo
//     de la aurora, una fugaz) sale con dientes de peine. Y pintar filas sueltas
//     no ahorra: la gráfica calcula en bloques de 2 × 2.
//   - Dos texturas que se turnan en el sprite: cambiarle la textura a un sprite
//     obliga a Pixi a rehacer las instrucciones de dibujo de la escena entera
//     (medido: +0,6 ms de JS por fotograma). Por eso la imagen terminada se COPIA
//     a la textura del sprite, que es siempre la misma (una copia en la gráfica).

import { Geometry, Rectangle, RenderTexture, Sprite, State } from 'pixi.js';

import { sameSkyGrid, skyBand } from '../systems/skyGrid.js';

/**
 * @param {ReturnType<import('./skyShader.js').createSkyShader>} sky  El shader del cielo.
 */
export function createSkyBuffer(sky) {
    /** Lo que va a la escena: la imagen completa, estirada a la pantalla. */
    const sprite = new Sprite();
    sprite.label = 'sky';

    // El rectángulo que llena la banda: [0,1] × [0,1] (ver background.vert).
    const quad = new Geometry({
        attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
        indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    // El shader escribe el color entero (alfa 1): sin mezcla.
    const state = State.for2d();
    state.blend = false;

    const frame = new Rectangle();
    const uv = new Float32Array(4);
    // Para la copia (Pixi los modifica al recortar: se rellenan cada vez).
    const from = { x: 0, y: 0 };
    const to = { x: 0, y: 0 };
    const size = { width: 0, height: 0 };

    /** La imagen que se enseña (la del sprite) y la que se está pintando. @type {RenderTexture | null} */
    let shown = null;
    /** @type {RenderTexture | null} */
    let work = null;
    /** @type {import('../systems/skyGrid.js').SkyGrid | null} */
    let grid = null;
    /** Banda que toca y en cuántas se reparte la imagen en curso. */
    let next = 0;
    let bands = 1;

    const create = (g) => RenderTexture.create({ width: g.width, height: g.height, resolution: 1, antialias: false, scaleMode: 'nearest' });

    function paint(renderer, index, count) {
        const band = skyBand(grid, index, count, uv);
        frame.x = 0;
        frame.y = band.row;
        frame.width = grid.width;
        frame.height = band.rows;
        sky.setFrameRect(uv[0], uv[1], uv[2], uv[3]);
        // Sin borrar: las bandas ya pintadas de esta imagen se quedan.
        renderer.renderTarget.bind(work, false, undefined, frame);
        renderer.encoder.draw({ geometry: quad, shader: sky.shader, state });
    }

    /** La imagen recién terminada pasa a la textura que se enseña. */
    function present(renderer) {
        from.x = 0;
        from.y = 0;
        to.x = 0;
        to.y = 0;
        size.width = grid.width;
        size.height = grid.height;
        renderer.renderTarget.copyToTexture(renderer.renderTarget.getRenderTarget(work), shown, from, size, to);
        next = 0;
    }

    return {
        sprite,

        /** La rejilla vigente (para el panel dev y la lectura de rendimiento). */
        get grid() { return grid; },

        /**
         * ¿La próxima banda empieza una imagen? Es el momento de fijar el estado del
         * cielo (los uniforms del shader): todas sus bandas tienen que ser del mismo
         * instante.
         */
        get startsImage() { return next === 0; },

        /**
         * Ajusta el búfer a una rejilla. Devuelve si hubo que crearlo de nuevo (hay
         * que pintarlo entero antes de enseñarlo).
         *
         * @param {import('../systems/skyGrid.js').SkyGrid} wanted
         */
        configure(wanted) {
            if (sameSkyGrid(grid, wanted)) {
                grid = wanted;
                return false;
            }
            const old = [shown, work];
            // `nearest`: un texel es un bloque nítido. Lo que el shader dibuja en
            // celdas del arte sale exacto; suavizado, cada estrella tendría un borde
            // borroso.
            shown = create(wanted);
            work = create(wanted);
            sprite.texture = shown;
            sprite.width = wanted.spriteWidth;
            sprite.height = wanted.spriteHeight;
            grid = wanted;
            next = 0;
            for (const t of old) t?.destroy(true);
            return true;
        },

        /**
         * Pinta la banda de este fotograma. Con `whole`, la imagen entera de una vez
         * (búfer nuevo, cambio de escena o de estado: no puede esperar k fotogramas).
         *
         * @param {number} count   En cuántas bandas se reparte una imagen (systems/skyGrid.js,
         *                         skyBandCount). Solo cuenta al empezar una.
         * @param {boolean} [whole]
         */
        draw(renderer, count, whole = false) {
            if (grid === null) return;
            if (whole) {
                paint(renderer, 0, 1);
                present(renderer);
                return;
            }
            if (next === 0) bands = Math.max(1, Math.min(grid.height, Math.round(count)));
            paint(renderer, next, bands);
            next++;
            if (next >= bands) present(renderer);
        },

        destroy() {
            shown?.destroy(true);
            work?.destroy(true);
            quad.destroy(true);
            shown = null;
            work = null;
            grid = null;
        },
    };
}
