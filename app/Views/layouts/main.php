<?php
/**
 * Layout HTML5 base para todas las páginas server-rendered.
 *
 * Contrato de variables (todas pasadas por View::render):
 *   - string $title         Título de la pestaña.
 *   - string $description   Qué es esta página, en una frase (T06). Es lo que
 *                           enseña una aplicación de mensajería bajo el enlace.
 *   - string $canonicalUrl  Dirección absoluta de la página, o '' si no se conoce
 *                           el dominio (APP_URL).
 *   - string $voutOrigin    Origin completo de Vout (ej. https://vout.local).
 *                           Lo lee bridge.js para validar postMessage. Si está
 *                           vacío, el bridge ignorará todos los mensajes — útil
 *                           en standalone donde no hay parent.
 *   - int    $uploadMaxMb   Tamaño máximo permitido para drag&drop de MP3.
 *                           Lo lee resources/js/ui/upload.js.
 *   - string $content       HTML pre-renderizado de la página hija. NO escapar.
 *
 * Estructura visual (consistente con docs 06):
 *   <body>
 *     <div id="app"></div>           ← canvas Pixi (engine.js lo append-ea aquí)
 *     <div id="hint">…</div>         ← overlay drag&drop, oculto cuando audio:ready
 *     <?= $content ?>                ← contenido específico de la página (ahora vacío)
 *   </body>
 */

use App\Core\View;
use App\Core\ViteAssets;

/** @var string $title */
/** @var string $description */
/** @var string $canonicalUrl */
/** @var string $voutOrigin */
/** @var int $uploadMaxMb */
/** @var string $content */
?>
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="dark">
    <meta name="referrer" content="strict-origin-when-cross-origin">

    <!-- Contrato con resources/js/iframe/bridge.js: validación de event.origin
         en postMessage. Vacío en standalone = el bridge no atiende mensajes. -->
    <meta name="daino:vout-origin" content="<?= View::e($voutOrigin) ?>">

    <!-- Contrato con resources/js/ui/upload.js: tamaño máximo de MP3. -->
    <meta name="daino:upload-max-mb" content="<?= View::e($uploadMaxMb) ?>">

    <title><?= View::e($title) ?></title>

    <!-- Lo que ve quien recibe un enlace (T06): el nombre del nivel y qué es Daino. -->
<?php if (($description ?? '') !== ''): ?>
    <meta name="description" content="<?= View::e($description) ?>">
    <meta property="og:description" content="<?= View::e($description) ?>">
<?php endif; ?>
    <meta property="og:site_name" content="Daino">
    <meta property="og:type" content="website">
    <meta property="og:title" content="<?= View::e($title) ?>">
<?php if (($canonicalUrl ?? '') !== ''): ?>
    <meta property="og:url" content="<?= View::e($canonicalUrl) ?>">
    <link rel="canonical" href="<?= View::e($canonicalUrl) ?>">
<?php endif; ?>

    <?= ViteAssets::render(['resources/js/main.js', 'resources/css/main.css']) ?>
</head>
<body>
    <div id="app" aria-hidden="true"></div>

    <!-- Bloque 6: contenedores DOM donde los módulos UI montan.
         - #menu-root  → modo "no jugando" (ui/menu.js). Estado base.
         - #hud-root   → HUD durante partida (ui/hud.js). Oculto en menú.
         - #modal-root → host de los <dialog> (ui/modals.js). Always-mounted.
         Los 3 son siblings del #app para no interferir con Pixi y se posicionan
         con `position: fixed` desde main.css. `pointer-events: none` por
         defecto excepto en interactivos hijos. -->
    <div id="menu-root"></div>
    <div id="hud-root"></div>
    <div id="modal-root"></div>

    <!-- Anchor temporal del chip de identidad. Lote B lo monta aquí; Lote C
         lo migra al header del #menu-root cuando menu.js exista. -->
    <div id="auth-anchor"></div>

    <!-- #hint = overlay efímero (Bloque 6). Oculto al boot (la pantalla
         inicial es el menú). AppController lo muestra durante LOADING con
         texto "Generando nivel…". Si en futuro se quiere texto durante
         dragover, upload.js lo gestionaría aquí también. -->
    <div id="hint" class="is-hidden" role="status" aria-live="polite"></div>

    <?= $content ?>
</body>
</html>
