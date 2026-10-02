// Sección "Efectos" del panel de desarrollo (T03.1) — SOLO en `import.meta.env.DEV`
// (la monta devTools.js; nunca llega al bundle de producción).
//
// Cada efecto de la música tiene nombre (game/fx/registry.js) y aquí su fila:
//   - encendido / apagado;
//   - SOLO: ver ese efecto sin los demás;
//   - intensidad, de 0 a 2 (1 = la suya);
//   - su nivel en vivo y, si no se ve, POR QUÉ ("no es de noche", "la escena no lo
//     permite", "preferencia del jugador"…): lo dice el director de efectos.
// Así "el brillo del horizonte, bájale intensidad" es una frase que el user y el
// desarrollo entienden igual.
//
// Arriba: el maestro (ver el escenario sin efectos), la preferencia del jugador
// simulada (Completos, Suaves, Mínimos, sin tocar la guardada) y las señales en
// vivo (pulso, graves, agudos, intensidad del tramo).
//
// No guarda estado del juego: empuja lo elegido con `engine.setFxOverrides` y lee
// `engine.getFx()` al refrescar.

import { FX, FX_FAMILIES, FX_IDS, FX_PREFS } from '../game/fx/registry.js';
import { getFxLevel } from './settings.js';

/**
 * @param {HTMLElement} panel
 * @param {{ el: Function, checkRow: Function }} ui  Constructores de devTools.js.
 * @returns {{ refresh: () => void }}
 */
export function mountFxPanel(panel, { el, checkRow }) {
    const engine = () => window.__daino?.engine;
    const off = new Set();
    const gain = {};
    let solo = null;
    const push = () => engine()?.setFxOverrides?.({ off, solo, gain });

    panel.appendChild(el('p', 'daino-devtools__heading', 'EFECTOS'));

    const master = checkRow('Efectos de la música', true, (on) => engine()?.setAudioFxEnabled?.(on));
    master.row.title = 'Apagado: se ve el escenario solo, sin lo que late con la música';
    panel.appendChild(master.row);

    // La preferencia del jugador, simulada (no se guarda).
    const prefRow = el('label', 'daino-devtools__row', 'Jugador ');
    const prefSelect = document.createElement('select');
    for (const [value, label] of [['', 'su ajuste'], ...Object.entries(FX_PREFS).map(([id, p]) => [id, p.label])]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        prefSelect.appendChild(opt);
    }
    prefSelect.addEventListener('change', () => engine()?.setFxPref?.(prefSelect.value || getFxLevel()));
    prefRow.appendChild(prefSelect);
    panel.appendChild(prefRow);

    const signalsLine = el('p', 'daino-devtools__plan', '');
    panel.appendChild(signalsLine);

    /** @type {Record<string, { meter: HTMLElement, why: HTMLElement, soloBtn: HTMLButtonElement }>} */
    const rows = {};
    const box = el('div', 'daino-devtools__fx');
    for (const [familyId, family] of Object.entries(FX_FAMILIES)) {
        const ids = FX_IDS.filter((id) => FX[id].family === familyId);
        if (ids.length === 0) continue;
        box.appendChild(el('p', 'daino-devtools__fx-family', family.label));
        for (const id of ids) {
            const row = el('div', 'daino-devtools__fx-row');
            row.title = `id: ${id} · plano: ${FX[id].plane} · coste: ${FX[id].cost}`;

            const toggle = checkRow(FX[id].label, true, (on) => {
                if (on) off.delete(id);
                else off.add(id);
                push();
            });

            const soloBtn = el('button', 'daino-devtools__solo', 'solo');
            soloBtn.type = 'button';
            soloBtn.title = 'Ver solo este efecto';
            soloBtn.addEventListener('click', () => {
                solo = solo === id ? null : id;
                for (const [other, r] of Object.entries(rows)) r.soloBtn.dataset.on = String(solo === other);
                push();
            });

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '2';
            slider.step = '0.05';
            slider.value = '1';
            slider.setAttribute('aria-label', `Intensidad de ${FX[id].label}`);
            slider.addEventListener('input', () => {
                const v = Number(slider.value);
                if (v === 1) delete gain[id];
                else gain[id] = v;
                push();
            });

            const meter = el('span', 'daino-devtools__meter');
            const fill = el('i');
            meter.appendChild(fill);
            const why = el('p', 'daino-devtools__why', '');

            row.append(toggle.row, soloBtn, slider, meter, why);
            box.appendChild(row);
            rows[id] = { meter: fill, why, soloBtn };
        }
    }
    panel.appendChild(box);

    return {
        /** Niveles, motivos y señales en vivo (lo llama devTools al refrescar). */
        refresh() {
            const fx = engine()?.getFx?.();
            if (!fx) return;
            for (const id of FX_IDS) {
                const r = rows[id];
                if (!r) continue;
                const level = fx.levels[id] ?? 0;
                r.meter.style.width = `${Math.round(Math.min(1, level / 2) * 100)}%`;
                r.why.textContent = fx.reasonOf(id);
            }
            const s = fx.signals;
            signalsLine.textContent = s.playing
                ? `pulso ${s.beat.pulse.toFixed(2)} · graves ${s.live.bass.toFixed(2)} · agudos ${s.live.high.toFixed(2)} · tramo ${s.song.intensity.toFixed(2)}`
                : 'Sin música';
        },
    };
}
