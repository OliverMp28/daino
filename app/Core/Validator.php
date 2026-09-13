<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Validator — helpers de validación inline.
 *
 * Sin librería externa. Suficiente para los 4 controllers del Bloque 7. El
 * patrón es: cada helper estático recibe el valor crudo y un array de opts,
 * y devuelve el valor coercionado. Si falla, lanza ValidationException con
 * un solo campo. Para validar múltiples campos a la vez, usar `run()`.
 *
 * Convenciones:
 *   - `required` (default true): si el valor es null o '' lanza.
 *   - `min`/`max`: aplican según tipo (rango numérico para int, longitud para string).
 *   - `pattern`: regex obligatorio para string.
 *   - `field`: nombre del campo para el mensaje de error (default 'value').
 */
final class Validator
{
    /**
     * @param array{required?: bool, min?: int, max?: int, field?: string} $opts
     */
    public static function int(mixed $value, array $opts = []): int
    {
        $field = $opts['field'] ?? 'value';
        $required = $opts['required'] ?? true;

        if ($value === null || $value === '') {
            if ($required) {
                throw new ValidationException([$field => 'Required.']);
            }
            return 0;
        }

        if (is_bool($value) || (!is_int($value) && !is_string($value) && !is_float($value))) {
            throw new ValidationException([$field => 'Must be an integer.']);
        }

        // FILTER_VALIDATE_INT acepta strings numéricos sin decimales.
        $coerced = filter_var($value, FILTER_VALIDATE_INT);
        if ($coerced === false) {
            throw new ValidationException([$field => 'Must be an integer.']);
        }

        if (isset($opts['min']) && $coerced < $opts['min']) {
            throw new ValidationException([$field => "Must be ≥ {$opts['min']}."]);
        }
        if (isset($opts['max']) && $coerced > $opts['max']) {
            throw new ValidationException([$field => "Must be ≤ {$opts['max']}."]);
        }

        return $coerced;
    }

    /**
     * @param array{required?: bool, min?: int, max?: int, pattern?: string, field?: string} $opts
     */
    public static function string(mixed $value, array $opts = []): string
    {
        $field = $opts['field'] ?? 'value';
        $required = $opts['required'] ?? true;

        if ($value === null) {
            if ($required) {
                throw new ValidationException([$field => 'Required.']);
            }
            return '';
        }

        if (!is_string($value)) {
            throw new ValidationException([$field => 'Must be a string.']);
        }

        $trimmed = trim($value);
        if ($trimmed === '' && $required) {
            throw new ValidationException([$field => 'Required.']);
        }

        $len = mb_strlen($trimmed);
        if (isset($opts['min']) && $len < $opts['min']) {
            throw new ValidationException([$field => "Must be ≥ {$opts['min']} characters."]);
        }
        if (isset($opts['max']) && $len > $opts['max']) {
            throw new ValidationException([$field => "Must be ≤ {$opts['max']} characters."]);
        }
        if (isset($opts['pattern']) && preg_match($opts['pattern'], $trimmed) !== 1) {
            throw new ValidationException([$field => 'Invalid format.']);
        }

        return $trimmed;
    }

    /**
     * Número real finito. Acepta enteros y strings numéricos; rechaza NaN,
     * Infinity y booleanos (que PHP convertiría silenciosamente a 0/1).
     *
     * @param array{required?: bool, min?: float, max?: float, field?: string} $opts
     */
    public static function float(mixed $value, array $opts = []): float
    {
        $field = $opts['field'] ?? 'value';
        $required = $opts['required'] ?? true;

        if ($value === null || $value === '') {
            if ($required) {
                throw new ValidationException([$field => 'Required.']);
            }
            return 0.0;
        }

        if (is_bool($value) || (!is_int($value) && !is_float($value) && !is_string($value))) {
            throw new ValidationException([$field => 'Must be a number.']);
        }

        $coerced = filter_var($value, FILTER_VALIDATE_FLOAT);
        if ($coerced === false || !is_finite($coerced)) {
            throw new ValidationException([$field => 'Must be a number.']);
        }

        if (isset($opts['min']) && $coerced < $opts['min']) {
            throw new ValidationException([$field => "Must be ≥ {$opts['min']}."]);
        }
        if (isset($opts['max']) && $coerced > $opts['max']) {
            throw new ValidationException([$field => "Must be ≤ {$opts['max']}."]);
        }

        return $coerced;
    }

    /**
     * @param array{required?: bool, field?: string} $opts
     */
    public static function bool(mixed $value, array $opts = []): bool
    {
        $field = $opts['field'] ?? 'value';
        $required = $opts['required'] ?? true;

        if ($value === null) {
            if ($required) {
                throw new ValidationException([$field => 'Required.']);
            }
            return false;
        }

        $coerced = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($coerced === null) {
            throw new ValidationException([$field => 'Must be a boolean.']);
        }
        return $coerced;
    }
}
