<?php
declare(strict_types=1);

namespace App\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Core\Validator;
use App\Models\Ranking;
use App\Models\User;

/**
 * RankingApiController — GET /api/ranking (público, sin Bearer).
 *
 * Lista paginada del leaderboard global. JOIN manual a `users` con un único
 * SELECT IN para evitar N+1 (no usamos ORM, así que el N+1 solo aparece si
 * lo escribimos a mano — y aquí lo evitamos explícitamente).
 */
final class RankingApiController
{
    public function index(Request $req): Response
    {
        $limit  = Validator::int($req->query('limit', 10),  ['min' => 1, 'max' => 50, 'required' => false, 'field' => 'limit']);
        $offset = Validator::int($req->query('offset', 0),  ['min' => 0, 'max' => 100_000, 'required' => false, 'field' => 'offset']);

        $rankings = Ranking::topN($limit, $offset);
        $total = Ranking::countAll();

        // Hidratar info de user (username + avatar_url) en una sola query.
        $usersById = User::publicProfilesByIds(array_map(static fn ($r) => $r->userId, $rankings));

        $items = [];
        foreach ($rankings as $i => $r) {
            $items[] = [
                'rank'           => $offset + $i + 1,
                'user'           => $usersById[$r->userId] ?? null,
                'total_points'   => $r->totalPoints,
                'avg_percentage' => $r->avgPercentage,
                'levels_played'  => $r->levelsPlayed,
                'updated_at'     => $r->updatedAt,
            ];
        }

        return Response::json([
            'items'  => $items,
            'total'  => $total,
            'limit'  => $limit,
            'offset' => $offset,
        ]);
    }
}
