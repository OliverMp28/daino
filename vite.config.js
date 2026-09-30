import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Vite actúa como pipeline de assets para un backend PHP.
// - `dev`:   sirve HMR en localhost:VITE_DEV_PORT (default 5174 — Vout usa
//            5173 por convención Laravel/sail). public/index.php lee
//            VITE_DEV_SERVER del .env y embebe los módulos desde esa URL.
// - `build`: compila a public/build/ con manifest.json; public/index.php lo
//            lee y emite <script>/<link> con los filenames hasheados.
//
// El PHP nunca necesita saber que Vite existe más allá de leer ese manifest.

export default defineConfig(({ command, mode }) => {
  // loadEnv lee el .env del proyecto. Pasamos prefix '' para incluir TODAS las
  // variables (no solo las que arrancan por VITE_), porque también queremos
  // VITE_DEV_PORT que no se inyecta al cliente — solo al config server-side.
  const env = loadEnv(mode, __dirname, '');
  const devPort = Number.parseInt(env.VITE_DEV_PORT ?? '5174', 10);

  return {
    plugins: [
      tailwindcss(),
      // GLSL imports + HMR de shaders. Ver doc 09 §1.4.
      //   - `compress: false` deja la minificación a Oxc/Lightning en build.
      //   - `watch: true` activa HMR; resources/js/game/shaders/audioFilter.js
      //     usa import.meta.hot.accept para reinstanciar el GlProgram en caliente.
      //   - `removeDuplicatedImports` evita CSS-like duplicación al usar #include.
      glsl({
        include: ['**/*.glsl', '**/*.frag', '**/*.vert', '**/*.fs', '**/*.vs'],
        defaultExtension: 'glsl',
        warnDuplicatedImports: true,
        removeDuplicatedImports: true,
        compress: false,
        watch: true,
        root: '/',
      }),
    ],

    // `base` solo en build. En dev Vite sirve en la raíz del puerto (para que
    // `http://localhost:<port>/resources/js/main.js` funcione tal cual lo emite
    // ViteAssets.php). En build los assets viven en /build/: las entradas las
    // resuelve ViteAssets con el manifest (rutas relativas, no le afecta), pero
    // lo que Vite referencia DESDE el propio bundle necesita el prefijo real. Sin
    // él, el Web Worker del análisis (Ola 4) salía como `/assets/…` → 404 → todo
    // el análisis en el hilo principal sin ningún error visible.
    base: command === 'build' ? '/build/' : '/',

    server: {
      host: '127.0.0.1',
      port: devPort,
      strictPort: true,        // falla ruidoso si el puerto está ocupado en
                               //  vez de saltar a otro y dejar VITE_DEV_SERVER
                               //  apuntando a un puerto donde Daino no está.
      cors: {
        origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
      },
    },

    // publicDir: false porque public/ contiene index.php server-side; no hay
    // estáticos que Vite deba copiar a outDir. Sin esto, Vite avisa con
    // "outDir y publicDir no son carpetas separadas" (outDir vive dentro de
    // public/, lo cual rompe la feature publicDir si se usase).
    publicDir: false,

    build: {
      outDir: 'public/build',
      emptyOutDir: true,
      // manifest: 'manifest.json' (no `true`) sobrescribe el default de Vite 5+,
      // que es `<outDir>/.vite/manifest.json`. Lo aplanamos a
      // `public/build/manifest.json` para que ViteAssets::renderProd lo lea
      // sin saber del subdirectorio `.vite/`. Si en algún momento se cambia a
      // `manifest: true`, también hay que actualizar la ruta en ViteAssets.php.
      manifest: 'manifest.json',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'resources/js/main.js'),
          styles: resolve(__dirname, 'resources/css/main.css'),
        },
        output: {
          // PixiJS entero en un solo chunk (T02.1). Sus renderers se cargan con
          // import() y sus clases se heredan en círculo; en cuanto hay chunks
          // propios que importan Pixi (las capas de escena que se cargan bajo
          // demanda), el reparto por defecto partía Pixi en varios chunks que se
          // importaban en círculo, y en producción el juego no arrancaba
          // ("Class extends value undefined" en el chunk del CanvasRenderer). En
          // desarrollo no pasa: Vite no parte nada.
          advancedChunks: {
            groups: [{ name: 'pixi', test: /[\\/]node_modules[\\/](pixi\.js|@pixi)[\\/]/ }],
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': resolve(__dirname, 'resources/js'),
        '@css': resolve(__dirname, 'resources/css'),
      },
    },
  };
});
