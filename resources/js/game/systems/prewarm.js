// Precalentado (T05.3): pintar una vez, al empezar el intento, lo que el nivel
// enseñará más tarde.
//
// La primera vez que la gráfica pinta algo hay trabajo que no se repite: subir su
// textura, triangular su forma, compilar su programa. Si esa primera vez cae a
// mitad de canción, es un tirón. Medido en What's Up Danger: al asomar el primer
// túnel del propulsor (2:08), un fotograma de 100 ms y otro de 50 — sus muros son
// un `Graphics` de cientos de puntos (triangularlo: 15 ms) con un programa que
// nadie había usado todavía (compilarlo: el resto).
//
// La solución es hacer esa primera vez bajo el fundido a negro del arranque: se
// enseña un momento todo lo que está oculto, se pinta la escena en una textura
// mínima que nadie ve y se vuelve a ocultar. La pantalla no se toca.

import { RenderTexture } from 'pixi.js';

/** Donde se pinta: lo pequeño que sea da igual, lo que cuenta es que se pinte. */
let target = null;

/**
 * @param {import('pixi.js').Renderer} renderer
 * @param {import('pixi.js').Container} stage   La escena entera (los objetos se pintan en su sitio del árbol).
 * @param {Array<import('pixi.js').Container | null | undefined>} roots
 *        Lo que hay que precalentar: ellos y todo lo que cuelga de ellos, aunque esté oculto.
 */
export function prewarm(renderer, stage, roots) {
    if (!renderer || !stage) return;
    const hidden = [];
    const faded = [];
    const reveal = (node) => {
        if (node.visible === false) {
            hidden.push(node);
            node.visible = true;
        }
        if (node.alpha === 0) {
            faded.push(node);
            node.alpha = 1;
        }
        const kids = node.children;
        if (kids) for (let i = 0; i < kids.length; i++) reveal(kids[i]);
    };
    for (const root of roots) if (root) reveal(root);
    if (hidden.length === 0 && faded.length === 0) return;

    try {
        target ??= RenderTexture.create({ width: 32, height: 32, resolution: 1 });
        renderer.render({ container: stage, target });
    } catch (err) {
        // Un precalentado que falla no impide jugar: solo vuelve el tirón.
        console.warn('[prewarm] no se pudo precalentar la escena:', err);
    } finally {
        for (const node of hidden) node.visible = false;
        for (const node of faded) node.alpha = 0;
    }
}
