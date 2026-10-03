// Sección "Rendimiento" (T05). La monta el panel de desarrollo (devTools.js, solo
// en `bun run dev`) y, con `?perf=1`, el panel táctil de ui/perfReadout.js (también
// en producción, en su propio chunk).
//
//   - La línea de rendimiento en vivo (la misma de `?perf=1`): fotogramas, tardíos,
//     JS por fotograma, calidad, cielo y pantalla; y el búfer del cielo (su tamaño
//     y en cuántas bandas se reparte cada imagen).
//   - Calidad: la automática o una fija, como en AJUSTES (sin guardarla).
//   - Cielo: los texeles por celda y las veces por segundo que se renueva, para
//     compararlos JUGANDO. "Nativo" y "cada fotograma" es como se pintaba antes de
//     la T05; "quieto" lo congela (lo que cuesta todo lo demás).

import { perfLine } from './perfModel.js';
import { getQuality } from './settings.js';

/**
 * @param {HTMLElement} panel
 * @param {{ el: Function }} ui  Constructores de devTools.js.
 * @returns {{ refresh: () => void }}
 */
export function mountPerfPanel(panel, { el }) {
    const engine = () => window.__daino?.engine;

    panel.appendChild(el('p', 'daino-devtools__heading', 'RENDIMIENTO'));
    const line = el('p', 'daino-devtools__readout', '—');
    const sky = el('p', 'daino-devtools__plan', '');
    panel.append(line, sky);

    const select = (label, options, onChange) => {
        const row = el('label', 'daino-devtools__row', `${label} `);
        const node = document.createElement('select');
        for (const [value, text] of options) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            node.appendChild(opt);
        }
        node.addEventListener('change', () => onChange(node.value));
        row.appendChild(node);
        panel.appendChild(row);
        return node;
    };

    select('Calidad', [['', 'la de AJUSTES'], ['auto', 'Auto (de cero)'], ['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']], (v) => {
        if (v === '') engine()?.setQualityTier?.(getQuality());
        else engine()?.setQualityTier?.(v, { fresh: true });
    });
    select('Cielo', [['', 'el de la calidad'], ['99', 'nativo (antes)'], ['6', '6 texeles'], ['4', '4 texeles'], ['2', '2 texeles']], (v) => {
        engine()?.setSkyOverride?.({ texels: v === '' ? null : Number(v) });
    });
    select('Ritmo del cielo', [['', 'el del estado'], ['1000', 'cada fotograma (antes)'], ['30', '30 por segundo'], ['15', '15'], ['10', '10'], ['0', 'quieto']], (v) => {
        engine()?.setSkyOverride?.({ hz: v === '' ? null : Number(v) });
    });

    return {
        refresh() {
            const p = engine()?.getPerf?.();
            if (!p) return;
            line.textContent = perfLine(p);
            sky.textContent = p.skySize
                ? `Cielo ${p.skySize[0]}×${p.skySize[1]} (${p.skyTexels} de ${p.skyNative} texeles) · ${p.skyHz} Hz en ${p.skyBands} banda${p.skyBands === 1 ? '' : 's'} · lienzo ${p.canvas?.[0]}×${p.canvas?.[1]} ÷${p.divisor}`
                : 'Sin cielo (movimiento reducido)';
        },
    };
}
