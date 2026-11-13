# PTDIA · Proyecto 2

Asistente de exploración de estilos para dormitorios, con selección humano–IA, regeneración individual y un historial de decisiones. El alcance vigente está en [plan3](blueprint/plan/plan3.md) y la referencia visual en [el mockup](blueprint/design/chat-dormitorios-v1.png).

## Frontend de demostración

Implementado en [`frontend/`](frontend/README.md) con **React + TypeScript + Vite + Tailwind CSS**. Funciona sin backend: cinco estilos de ejemplo, carga de foto, decisiones versionadas, regeneración simulada, pausa, historial local y resumen de demostración.

Requiere Node.js 22.18 o posterior:

```bash
cd frontend
npm ci
npm run dev
```

Vite imprime la URL local, normalmente `http://127.0.0.1:5173`.

```bash
npm test
npm run build
```

Las imágenes son ilustrativas y las regeneraciones reutilizan el ejemplo de cada estilo. Las fotos y decisiones se guardan en IndexedDB de este navegador, sin envíos a servicios externos. El perfil es demostrativo y no ofrece autenticación privada. La [guía del frontend](frontend/README.md) explica el recorrido, las verificaciones y los puntos de integración.

## Referencias y trabajo pendiente

- [`blueprint/plan/plan3.md`](blueprint/plan/plan3.md): plan vigente de dormitorios, catálogo, API propuesta y reparto.
- [`poc/kaggle_back/`](poc/kaggle_back/README.md): prueba de concepto de inferencia; no equivale al backend completo de sesiones e historial.
- [`poc/khipu_front/`](poc/khipu_front/README.md): chat de prueba anterior, independiente del nuevo frontend.

La integración con FastAPI, SDXL/LoRA, Qwen, cuentas privadas y almacenamiento externo sigue pendiente. Las pruebas locales de la demo no acreditan generación real ni una integración con backend.
