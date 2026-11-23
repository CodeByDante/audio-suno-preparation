# Audio Suno Preparation

Procesador de audio local para GitHub Pages. El preset aplica una octava hacia abajo, mitad de velocidad, banda 220–1900 Hz, realce de 5,5 dB a 600 Hz, reverb larga, textura de vinilo y limitador con techo de −1 dBFS antes de codificar.

Los controles permiten modificar cada valor. El MP3 se codifica en estéreo a 44,1 kHz y 320 kbps con LameJS. El navegador necesita acceso a jsDelivr para cargar el codificador. Puede haber unos milisegundos de relleno propios del MP3. La reverb se mezcla dentro de la duración de salida.

Publica la raíz de la rama `main` en GitHub Pages. Para probar localmente, sirve la carpeta por HTTP.

## Estructura del proyecto

| Ruta | Contenido |
| --- | --- |
| `index.html` | Pantalla principal y punto de entrada de GitHub Pages. |
| `styles/style.css` | Estilos de la interfaz. |
| `src/app.mjs` | Controles, carga de audio y coordinación de los modos de trabajo. |
| `src/settings.mjs` | Valores del preset y frecuencia de muestreo. |
| `src/timeline.mjs` | Forma de onda y controles de selección. |
| `src/workers/audio-worker.js` | Procesamiento y codificación del audio en segundo plano. |

Para probar desde la raíz, ejecuta `python -m http.server 8000` y abre
`http://localhost:8000`.
