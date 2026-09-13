<?php
declare(strict_types=1);

namespace App\Services;

/**
 * Una entrada del manifiesto de oficiales no se puede sembrar. El seeder lo
 * informa y continúa con las demás.
 */
final class SeedSkip extends \RuntimeException
{
}
