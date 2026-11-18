# 4to estudio · Frontend de dormitorios

React + TypeScript + Vite + Tailwind CSS. Conserva el diseño de [plan3](../blueprint/plan/plan3.md) y el [mockup](../blueprint/design/chat-dormitorios-v1.png), con dos modos separados:

- **API:** Supabase Auth y la API completa de `backend/`, con trabajos asíncronos, cinco propuestas reales, fotos privadas, decisiones, regeneración e historial remoto.
- **Demo:** datos de ejemplo e IndexedDB local, sin inferencia ni autenticación. No se suben automáticamente sus proyectos o fotos al activar API.

## Ejecutar y configurar

Node.js **22.18 o posterior**. Desde `frontend/`:

```bash
npm ci
npm run dev
```

El servidor abre en **`http://localhost:5173`**, con puerto fijo para coincidir con el origen permitido por la plantilla Kaggle. Si está ocupado, Vite lo informa en lugar de cambiar de puerto. `npm run preview` usa otro puerto: autorizar su origen exacto en `BEDROOM_ORIGINS` si se usa contra el backend.

Crear `.env.local` a partir de [`.env.example`](.env.example) **solo si no existe**, sin reemplazar valores personales. El archivo local está excluido de Git.

```dotenv
VITE_APP_MODE=api
VITE_API_BASE_URL=https://TU-BACKEND.ngrok-free.app
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Completar URL del proyecto y publishable key de Supabase. El dominio ngrok es la URL base, sin `/docs`; las rutas `/api/` se añaden en el cliente. **Mientras `TU-BACKEND` siga como placeholder, se puede preparar el acceso Supabase, pero no se hacen llamadas al backend ficticio.** La vista informa que falta activar la conexión.

Usar únicamente configuración pública en `VITE_*`: nunca claves `sb_secret_*`, claves `service_role`, contraseñas PostgreSQL ni tokens Kaggle/ngrok. Vite comprueba las claves secretas reconocibles antes de empaquetar. La sesión del usuario se gestiona con el SDK oficial en `localStorage`, compartida entre pestañas del mismo perfil para mantener coherentes los eventos de Supabase y el bearer vigente. Cambiar de cuenta o salir afecta a esas pestañas; el acceso persiste al reabrir hasta cerrarlo o vencer. No se ponen bearer tokens en `.env.local`.

Para usar solo la demo, definir `VITE_APP_MODE=demo`. Sin configuración alguna también se abre la demo, identificada como tal. Un modo API parcialmente configurado muestra el estado de configuración pendiente y no se convierte silenciosamente en demo. Guardar los cambios de entorno; reiniciar Vite si fuera necesario.

## Contrato que usa el frontend

La fuente está en [`backend/FRONTEND.md`](../backend/FRONTEND.md), [`api.py`](../backend/src/bedroom_backend/api.py) y el `/openapi.json` del servidor. El JSON de la PoC con `image_base64`, `image_mime_type` y `description` **no es el contrato de sesiones conectado**.

- `POST /api/generations`: `FormData` con foto, `consent=true` y preferencias opcionales; respuesta `202 {session_id,job_id}`.
- `GET /api/jobs/{job_id}`: polling mientras `queued/running`, seguido de recuperación del detalle de sesión. No se espera a la GPU dentro de la petición de creación.
- `GET /api/generations/{id}`: cinco `variations`, sus versiones, `current_version_id`, descripciones, jobs y resumen.
- `PUT /api/generations/{id}/decisions/{version_id}`: `{decision,reason?}`. La UI pide y valida un motivo obligatorio al rechazar; confirmar inicia solo la regeneración de esa posición. Cancelar no registra nada.
- Rutas de reintento inicial/por estilo, `confirm-bedroom`, resumen, pausa e historial/borrado, según la guía backend.

El cliente envía el bearer vigente y `ngrok-skip-browser-warning: true`, incluidas las descargas de imágenes. Renueva una vez el token ante `401`. Todos los POST/PUT llevan `Idempotency-Key`; se conserva al repetir una escritura de resultado desconocido por fallo de red o respuesta incompleta. Una acción confirmada nueva obtiene otra clave. Multipart no fija manualmente el boundary.

Las imágenes se descargan como Blob autenticado y se muestran mediante object URLs que se revocan al sustituirse o desmontarse. El cliente rechaza rutas de otro origen antes de enviar credenciales y bloquea redirecciones para evitar reenviar fotos o preferencias. El modo conectado no guarda fotos, decisiones ni resúmenes en el IndexedDB de demo.

## Comportamiento y límites actuales

- Con backend 0.2.0, **Luxury UTEC** es el modelo predeterminado. El formulario permite elegir **Luxury original**; la tarjeta Luxury permite cambiar después entre ambos. Se genera una nueva versión pendiente solo de ese estilo, sin registrar un rechazo automático ni modificar las otras cuatro propuestas.
- El cambio invalida resumen/galería hasta aceptar la sustituta y generar el nuevo resumen. Si falla, la imagen/decisión anterior sigue visible y **Reintentar** usa el modelo solicitado con sus parámetros guardados. Pausa y generación en curso deshabilitan el selector; conflictos 409 recuperan el estado vigente. El historial conserva el nombre del modelo de cada versión. No hay selector simulado en modo demo.

- JPEG/PNG/WebP, hasta 10 MiB y 25 MP, con validación de cabecera y decodificación del navegador; el backend vuelve a validar e impone imágenes estáticas.
- Al cambiar foto se restablecen confirmación de dormitorio y consentimiento. El formulario conectado no usa automáticamente la foto del mockup.
- Se conservan los IDs del servidor y las semillas como string. La versión vigente se busca por `current_version_id`; `decision: null` significa pendiente. Un lote parcial no se muestra como cinco propuestas listas.
- Las descripciones de las tarjetas admiten Markdown (negritas, párrafos y listas) mediante `react-markdown`. Se omiten HTML e imágenes incrustadas; las fotos siguen usando el endpoint privado autenticado.
- Una respuesta tardía del historial no revierte un alta/borrado confirmado; los conflictos 409 recargan el detalle antes de permitir repetir.
- Los estados iniciales `generating`, `needs_confirmation`, `rejected` y `failed` tienen pantallas de espera, confirmación de dormitorio, nueva foto o reintento. Los jobs siguen en el backend aunque se cierre la página; al volver se recuperan.
- Se puede eliminar también una sesión cuya foto fue rechazada, falló o sigue esperando propuestas. Un resumen fallido informa el error y permite reintentarlo.
- Cinco versiones actuales aceptadas habilitan el resumen. Se muestra el texto de **`session.summary.summary`** solo para la revisión vigente. El cálculo de resumen de la demo no se ejecuta sobre datos remotos.
- Debajo del resumen aparece **Diseños aprobados**, con las cinco imágenes actuales, estilo/versión y vista ampliada. En modo API, **Descargar imagen** conserva los bytes originales y su extensión PNG/JPEG/WebP; **Descargar todas** crea un ZIP en el navegador con esos cinco archivos (`<estilo>-v<número>.<extensión>`). Usa el mismo loader autenticado y no requiere un endpoint nuevo. Si falla una descarga, se muestra el error y se permite reintentar; no se guarda un ZIP parcial.
- Rechazar o cambiar una versión invalida el resumen y oculta la galería. Aceptar la sustituta no basta: vuelve a aparecer al generar el resumen actualizado de las cinco aceptadas. Pausar conserva una selección final vigente. Cambiar de proyecto, salir o invalidar la selección aborta sus descargas pendientes. La demo muestra ejemplos y vistas ampliadas, sin descargas de propuestas reales.
- Pausar/reanudar se envía mediante PATCH. El control queda deshabilitado durante jobs activos porque el backend no ofrece cancelación de inferencia.
- **Nombres de cliente/espacio:** la API actual no tiene esos campos; se recuerdan como etiquetas locales separadas por cuenta. En otro navegador se muestran sesiones identificadas por fecha/ID. No se confunden con el propietario autenticado.
- **Preferencias del chat:** la API recibe preferencias al crear y el motivo de rechazo al regenerar; no tiene endpoint de chat/edición posterior. La barra conectada indica cómo ajustar por rechazo, sin prometer que un mensaje cambie el prompt remoto.
- El usuario inicia sesión con una cuenta precreada por el equipo; no se inventan rutas `/api/auth/*` ni registro público.
- La UI obliga a indicar motivo de rechazo; el esquema del backend fusionado conserva `reason` opcional para otros clientes. No se modifica ese contrato como efecto secundario de esta integración.

Las etiquetas de cliente/espacio aún pueden sobrescribirse si se crean o borran proyectos simultáneamente en varias pestañas de la misma cuenta. Las sesiones, fotos y decisiones del servidor conservan su integridad; queda pendiente mejorar esa sincronización de etiquetas locales.

## Código y pruebas

| Archivo | Responsabilidad |
| --- | --- |
| `src/ConnectedApp.tsx`, `src/AuthStudio.tsx`, `src/auth.ts`, `src/config.ts` | Selección de modo, configuración pública, acceso y limpieza de cuenta. |
| `src/api.ts` | Transporte, JSON de errores, renovación de bearer, multipart e idempotencia. |
| `src/remote.ts` | Tipos, validación JSON y adaptación al modelo de presentación. |
| `src/useRemoteWorkspace.ts` | Sesiones, selección, escrituras, polling y recuperación. |
| `src/PrivateImage.tsx` | Imágenes autenticadas y ciclo de vida de object URLs. |
| `src/ApprovedGallery.tsx`, `src/downloads.ts` | Galería final vigente, descargas autenticadas de imágenes y ZIP sin versiones rechazadas. |
| `src/App.tsx`, `ProjectForm.tsx`, `ProposalCard.tsx`, `History.tsx` | Interfaz compartida entre modos, con controles conectados. |
| `src/domain.ts`, `storage.ts`, `useWorkspace.ts` | Reglas de la demo y persistencia local; desactivada en modo API. |

```bash
npm test
npm run build
npm run preview
```

**Verificación local: 92 pruebas frontend y build pasan; 66 pruebas backend con PostgreSQL desechable (incluidas selección Luxury, métricas operativas y selección de observaciones de backend 0.3.1).** La suite usa Node/tsx con procesos separados por archivo, Testing Library, Happy DOM y `fake-indexeddb`. Verifica transporte HTTP con respuestas controladas, JSON real de sesiones, estado del controlador, motivos, consentimiento y recuperación; también la galería final, invalidación, descarga individual, bytes del ZIP, fallos/reintentos y cancelación. Se comprobó la galería en navegador con datos locales controlados en escritorio/móvil y se descargó un ZIP con cinco PNG válidos. `src/fixtures/session.json` se contrastó con el modelo `SessionDetail` real del backend. La integración Luxury se comprobó además en navegador contra FastAPI/PostgreSQL/Worker reales locales con Auth e inferencia controladas: cambio a V2, otras cuatro V1 intactas, historial sin rechazo artificial, nueva aceptación y resumen/galería actualizados. Los tests de API/controlador no demuestran inferencia GPU ni disponibilidad del túnel.

La [guía backend](../backend/README.md) documenta las pruebas PostgreSQL, Kaggle, Supabase y el verificador autenticado con dos cuentas. Confirmar CORS para el origen exacto antes de las pruebas de navegador. Consultar [CONTEXTO_PROYECTO.md](../CONTEXTO_PROYECTO.md) para el estado de la rama y los siguientes pasos.
