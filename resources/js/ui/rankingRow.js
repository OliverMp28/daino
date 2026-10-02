// Una fila de ranking (T04): el puesto, quién y su marca. La comparten el ranking
// global (modals.js) y el de cada nivel (catalog.js); su aspecto, en dialogs.css.

import { renderAvatar } from './avatar.js';
import { el, px } from './kit.js';

/**
 * @param {{ rank: number, user?: { username: string, avatar_url?: string | null } | null,
 *           score: string, detail: string, isMe?: boolean }} row
 *        `score`: lo que va en la letra del juego (puntos). `detail`: la línea pequeña de debajo.
 * @returns {HTMLLIElement}
 */
export function rankingRow({ rank, user, score, detail, isMe = false }) {
    const row = el('li', isMe ? 'daino-ranking__row is-me' : 'daino-ranking__row');
    row.dataset.rank = String(rank);

    const stats = el('div', 'daino-ranking__stats');
    stats.append(px(score, 'daino-ranking__points'), el('span', 'daino-ranking__detail', detail));

    row.append(
        px(String(rank), 'daino-ranking__rank'),
        user ? renderAvatar(user.avatar_url, user.username, 32, { tag: 'span' }) : el('span'),
        el('span', 'daino-ranking__username', user?.username ?? '—'),
        stats,
    );
    return row;
}

/** Filas vacías del mismo alto, mientras llega el ranking: nada salta al llenarse. */
export function rankingGhosts(count) {
    return Array.from({ length: count }, () => el('li', 'daino-ranking__row daino-ranking__row--ghost'));
}
