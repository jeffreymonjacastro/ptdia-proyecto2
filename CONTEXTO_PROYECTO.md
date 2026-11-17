# Contexto de PTDIA Proyecto 2 para agentes

Actualizado el **17 de noviembre de 2026**, hora de Lima. Este documento permite continuar el trabajo sin el historial del chat. Describe el código revisado y distingue el frontend local, el backend existente en otra rama y las tareas de integración. No contiene credenciales ni supone que un túnel o una sesión de Kaggle sigan activos.

## 1. Empezar aquí

1. Leer [AGENTS.md](AGENTS.md) y comprobar `git status --short --branch` antes de modificar archivos.
2. Leer este documento, [plan3](blueprint/plan/plan3.md), [la guía del frontend](frontend/README.md) y [el mockup aprobado](blueprint/design/chat-dormitorios-v1.png).
3. Actualizar las referencias con `git fetch origin`. Consultar las ramas de backend y experimentos sin cambiar de checkout:

   ```bash
   git show origin/bedroom-backend:backend/FRONTEND.md
   git show origin/bedroom-backend:backend/README.md
   git show origin/fabryzzio/sdxl-lora-experiments:poc/lora_experiments/README.md
   ```

4. Para integrar, contrastar la guía del backend con `backend/src/bedroom_backend/api.py`, `service.py` y el `/openapi.json` del servidor activo. **El contrato ejecutable del backend prevalece sobre rutas propuestas antiguas del plan**, conservando los requisitos funcionales indicados abajo.
5. No asumir que integrar consiste en cambiar una URL: hay autenticación, trabajos asíncronos, imágenes privadas y diferencias entre modelos de datos.

## 2. Estado y ramas revisadas

Repositorio: `git@github.com:jeffreymonjacastro/ptdia-proyecto2.git`.

| Rama / revisión observada | Contenido y uso |
| --- | --- |
| `feat/frontend-dormitorios`, `d6aa5ec` | Rama actual de trabajo. Frontend completo de demostración, sin llamadas al backend. Los commits del frontend ya se enviaron a `origin`. |
| `main` / `origin/main`, `56ffe3f` | Base de la rama del frontend: blueprint y PoC. No contiene el nuevo frontend ni el backend de sesiones en la revisión consultada. |
| `origin/bedroom-backend`, `24374cf` | Backend FastAPI con PostgreSQL, Supabase Auth/Storage, trabajos persistentes y ejecución en Kaggle. Incluye una guía específica para frontend. **Existe, pero no está integrado en este checkout.** |
| `origin/fabryzzio/sdxl-lora-experiments`, `78dd467` | Entrenamiento/evaluación de LoRA y Qwen, manifiestos y resultados. Trabajo experimental separado del despliegue del producto. |

Los hashes son una fotografía del estado revisado, no una instrucción para volver a revisiones antiguas. Consultar cambios posteriores antes de implementar. La base común observada entre frontend y backend es `56ffe3f`; no hacer merge ni sustituir archivos automáticamente al leer esta guía.

Historial relevante del frontend:

- `7c46eea`: primera demo funcional siguiendo el mockup.
- `805a83a`: correcciones de motivos, consentimiento por foto, resumen recuperado y persistencia.
- `d6aa5ec`: al rechazar, pedir **motivo obligatorio** y confirmación antes de regenerar.

## 3. Producto y decisiones que deben conservarse

La aplicación **Estudio** ayuda a un diseñador de interiores a explorar opciones con su cliente. La interfaz es un chat oscuro, con proyectos por cliente en el lateral, foto original como adjunto, galería de tres tarjetas arriba y dos abajo en escritorio, historial y compositor inferior. En móvil se adapta a una columna y un menú lateral.

- Solo se admiten **habitaciones / dormitorios**. No ampliar silenciosamente a salas, cocinas u otros espacios.
- Cada lote inicial completo tiene **exactamente cinco** estilos y posiciones:

  | Posición | ID | Etiqueta |
  | --- | --- | --- |
  | 1 | `luxury` | Luxury |
  | 2 | `japanese` | Japanese |
  | 3 | `neo-classic` | Neo Classic |
  | 4 | `attic` | Attic |
  | 5 | `cyberpunk` | Cyberpunk |

- Las nuevas versiones empiezan pendientes. Pendiente no equivale a rechazada.
- **Rechazar abre una ventana y exige un motivo no vacío.** Cancelar o cerrar no registra decisión ni inicia regeneración. Confirmar guarda el motivo sobre esa versión y regenera únicamente su estilo, conservando las otras cuatro propuestas y sus decisiones.
- Al aceptar, el motivo es opcional. Un motivo de aceptación anterior nunca se reutiliza como motivo de rechazo.
- Conservar el original, las versiones y el historial. Regenerar desde el original con preferencias y feedback; no encadenar la imagen sintética anterior como entrada por defecto.
- Habilitar resumen final solo con cinco versiones actuales aceptadas. Cambiar una decisión o una versión invalida el resumen anterior. El resumen debe reflejar IDs, decisiones y motivos realmente registrados, incluidos rechazos históricos.
- Un lote parcial no se presenta como completo. Una respuesta obsoleta no debe reemplazar una versión vigente.
- Al cambiar la foto, exigir de nuevo confirmación de dormitorio y autorización. No heredar decisiones, resumen ni consentimiento de otra entrada.
- Conservar el diseño y los controles accesibles existentes. No presentar simulaciones como inferencia real ni la decoración generada como plano o garantía de conservación espacial.

Estas decisiones vienen del plan y de las solicitudes aceptadas del usuario; el motivo obligatorio al rechazar es una modificación explícita posterior al mockup. Los planes 1 y 2 son antecedentes de flores/personas, **no el alcance vigente**.

## 4. Frontend que existe hoy

Carpeta principal: [`frontend/`](frontend/README.md). React 19.3.1, TypeScript 7.0.2, Vite 8.3.8 y Tailwind CSS 4.3.5; dependencias fijadas en `package-lock.json`. Node.js **22.18 o posterior**.

Desde la raíz del repositorio:

```bash
cd frontend
npm ci
npm run dev
# En otra terminal, dentro de frontend:
npm test
npm run build
```

Vite usa `127.0.0.1`, normalmente puerto `5173`. No hay proxy, cliente HTTP de backend, variables de entorno de API ni cliente Supabase implementados. La demo no necesita Internet una vez instaladas las dependencias.

| Archivo | Responsabilidad / lugar de conexión |
| --- | --- |
| [`frontend/src/App.tsx`](frontend/src/App.tsx) | Proyectos/clientes, selección activa, `onAction`, alta/borrado local, chat, pausa, resumen y galería. `Workbench` contiene el recorrido de revisión. |
| [`frontend/src/ProjectForm.tsx`](frontend/src/ProjectForm.tsx) | Foto, cliente, nombre del espacio, preferencias y confirmaciones. Hoy llama `createProject` y espera 900 ms antes de añadirlo. Sustituir por el alta remota asíncrona. |
| [`frontend/src/ProposalCard.tsx`](frontend/src/ProposalCard.tsx) | Aceptar, pedir motivo de rechazo, confirmar, progreso y reintento por tarjeta. El temporizador de 1600 ms simula la nueva versión: no dejarlo activo en modo API. |
| [`frontend/src/domain.ts`](frontend/src/domain.ts) | Tipos locales, cinco estilos, `createProject`, `updateProject`, `currentVersion`, `canSummarize` y `buildSummary`. |
| [`frontend/src/photos.ts`](frontend/src/photos.ts) | JPEG/PNG/WebP, máximo 10 MiB y 25 MP, cabecera real y decodificación con `createImageBitmap`. El backend debe volver a validar. |
| [`frontend/src/storage.ts`](frontend/src/storage.ts) | IndexedDB y validación de la instantánea local. Reconstruye el resumen de demo desde las decisiones al recuperar. |
| [`frontend/src/useWorkspace.ts`](frontend/src/useWorkspace.ts) | Carga/guardado, avisos y recuperación sin descartar cambios recientes. |
| [`frontend/src/components.tsx`](frontend/src/components.tsx) | Diálogos nativos, imágenes de ejemplo, foto original mediante Blob/object URL e iconos. |
| [`frontend/src/History.tsx`](frontend/src/History.tsx) | Historial de decisiones y versiones. Tolera fechas ilegibles. |
| [`frontend/src/style.css`](frontend/src/style.css) | Diseño aprobado, estados y adaptación móvil. |

### Qué está simulado

- Cinco clientes iniciales y las imágenes/descripciones del mockup. `RoomImage` muestra ventanas SVG de `public/demo/bedrooms.png`; **no genera fotos**.
- Una nueva versión reutiliza la imagen del mismo estilo. El temporizador solo avanza mientras ese proyecto está abierto y no pausado.
- El chat guarda mensajes y sustituye `project.preferences` por el último texto enviado; la respuesta del asistente es fija.
- `buildSummary` construye un resumen determinista, sin Qwen.
- El perfil «Mariana» es un nombre editable, no una cuenta ni una identidad autenticada.
- IndexedDB (`ptdia-bedroom-demo`, versión 1; store `workspace`, clave `current`) guarda `{schema: 1, projects, activeId, designer}`, incluidas fotos como `Blob`. No es almacenamiento privado multiusuario ni sincronización entre pestañas.

No migrar ni subir automáticamente las fotos/proyectos locales a una cuenta real. Si se conserva la demo, separarla explícitamente del modo conectado y limpiar vistas, cachés privadas y object URLs al cerrar sesión o cambiar de usuario.

## 5. Backend disponible: usar esta implementación, no reinventarla

Guías de la rama: [contrato para frontend](https://github.com/jeffreymonjacastro/ptdia-proyecto2/blob/bedroom-backend/backend/FRONTEND.md) y [operación del backend](https://github.com/jeffreymonjacastro/ptdia-proyecto2/blob/bedroom-backend/backend/README.md). Si aún no se ha incorporado esa rama, leerlas con `git show` como se indica al inicio.

Su estructura es `backend/src/bedroom_backend/`, no la organización inicialmente propuesta `backend/app/`:

- `api.py`: rutas FastAPI, modelos de entrada/salida, CORS, autenticación y límites.
- `service.py`: sesiones, decisiones versionadas, idempotencia y referencias a trabajos.
- `worker.py` / `repository.py`: cola de trabajos y persistencia PostgreSQL; recuperación y publicación de versiones.
- `supabase.py`: validación de identidad y acceso servidor al bucket privado.
- `runtime.py` / `models.py`: arranque, SDXL y `Qwen/Qwen3.5-4B` en dos T4.
- `styles.json` / `catalog.py`: catálogo activo, hashes, revisiones, activadores y parámetros de las cinco LoRA.
- `summary.py`: Qwen selecciona extractos verificables de descripciones; el servidor construye el texto español con decisiones y motivos del registro. No sustituirlo por el resumen de demo del navegador.
- `migrations/001_bedroom.sql`, `tests/`, `kaggle/build_bundle.py` y `kaggle/verify_demo.py`: esquema, pruebas, empaquetado y verificación de despliegue.

El README de esa rama **reporta** una prueba GPU de cinco estilos/regeneración/resumen, un recorrido autenticado con Supabase/ngrok, recuperación tras reiniciar Kaggle y aislamiento con dos cuentas. Esta guía revisó el código y esos reportes; no volvió a ejecutar GPU, infraestructura o comprobaciones remotas. Confirmar disponibilidad actual antes de depender de ellos.

### Conexión y autenticación

Solicitar al responsable del backend: **origen ngrok actual**, **URL de Supabase**, **publishable key** y dos cuentas de prueba distintas, con contraseñas compartidas por un canal privado. No guardar aquí credenciales, tokens o URLs temporales como configuración permanente.

- Iniciar sesión mediante Supabase Auth con las cuentas precreadas. La demo del backend tiene deshabilitado el registro público. No implementar `/api/auth/register`, `/api/auth/login` o `/api/auth/logout` basándose en el plan: **esas rutas no existen en la implementación revisada**.
- En cada llamada `/api/`, enviar el `access_token` vigente como `Authorization: Bearer <token>`, también al descargar imágenes. Leer la sesión actual para respetar la renovación del token.
- Enviar `ngrok-skip-browser-warning: true` a la API ngrok.
- `GET /health` devuelve `200 {"status":"ready"}` cuando los servicios están listos; puede responder `503`. `/docs` y `/openapi.json` permiten comprobar el contrato actual.
- La plantilla Kaggle permite por defecto `http://localhost:5173`. **Nuestro frontend abre en `http://127.0.0.1:5173`: son orígenes distintos.** Añadir el origen exacto a `BEDROOM_ORIGINS` y reiniciar la API, o usar un origen coherente. También importa el puerto y el esquema HTTP/HTTPS.
- Como nombres de configuración del frontend se pueden usar `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`; son una propuesta, no variables ya implementadas. Los valores `VITE_*` se exponen al navegador. Nunca poner allí claves secretas de servidor, contraseñas de PostgreSQL, `HF_TOKEN` o `NGROK_TOKEN`.

### Rutas reales revisadas

Todas las rutas de la tabla tienen prefijo `/api`. `{id}` es la sesión, `{version_id}` una versión inmutable y `{position}` un entero de 1 a 5.

| Método y ruta | Entrada / respuesta / acción del frontend |
| --- | --- |
| `POST /generations` | Multipart `image`, `consent=true`, `preferences` opcional (hasta 2000 caracteres). `202 {session_id, job_id}`. Usar `FormData` y dejar que el navegador forme `Content-Type` y boundary. |
| `GET /generations` | `200` con array del historial propio: `id`, `status`, `revision`, `created_at`. |
| `GET /generations/{id}` | `200` con estado, original, variaciones/versiones, trabajos y resumen. |
| `GET /jobs/{job_id}` | Estado de un trabajo: `queued`, `running`, `succeeded` o `failed`, progreso aproximado y error. |
| `GET /generations/{id}/original` | Bytes privados de la foto original. |
| `GET /generations/{id}/versions/{version_id}/image` | Bytes privados de una versión. |
| `POST /generations/{id}/confirm-bedroom` | Sin cuerpo. Confirma una clasificación incierta; `202 {session_id, job_id}`. |
| `POST /generations/{id}/retry` | Sin cuerpo. Reintenta el lote inicial fallido; `202 {session_id, job_id}`. |
| `PUT /generations/{id}/decisions/{version_id}` | JSON `{"decision":"accepted"}` o `{"decision":"rejected","reason":"Conservar el techo"}`. `200` para aceptación/no-op; `202` con `job_id` al encolar regeneración. |
| `POST /generations/{id}/variations/{position}/retry` | Sin cuerpo. Reintenta la regeneración fallida del estilo; `202 {session_id, job_id}`. |
| `POST /generations/{id}/summary` | Sin cuerpo. `202 {session_id, job_id}` mientras se prepara, o `200` con el resumen vigente guardado. |
| `PATCH /generations/{id}` | `{"paused":true}` o `{"paused":false}`; `200 {id,status}`. El backend lo permite sin trabajos activos, en sesiones ready/completed/paused. |
| `DELETE /generations/{id}` | `202 {session_id,status:"deleting"}`. Retirar del historial; la limpieza se ejecuta detrás de la API. |

**Idempotencia:** todos los `POST` y el `PUT` de decisiones requieren `Idempotency-Key`. Generar un UUID por acción del usuario; reutilizarlo al repetir la misma petición cuyo resultado se desconoce tras un timeout/desconexión. Para otra acción, datos distintos o reintentar explícitamente un trabajo ya fallido, usar una clave nueva. Una repetición puede devolver un job antiguo ya finalizado: volver a consultar la sesión. No crear claves nuevas en cada reintento automático de la misma escritura.

### Modelo remoto frente al modelo local

El detalle remoto contiene `id`, `status`, `revision`, `created_at`, `preferences`, `original_image_url`, `variations`, `jobs` y `summary`.

| Demo local | Backend / adaptación necesaria |
| --- | --- |
| `Project.id` UUID local; IDs de versión `${projectId}:${style}:vN` | IDs UUID del servidor. Conservarlos como identificadores opacos; no fabricarlos ni derivarlos del número de versión. |
| `client`, `room`, `designer` y `messages` | No son campos del detalle remoto actual. Acordar persistencia/metadatos para conservar proyectos por cliente y chat; no confundir nombre del cliente con propietario autenticado. |
| `ProjectInput.consent` / `bedroomConfirmed` | Se comprueban en el formulario, pero el `Project` de demo no guarda esos flags. Enviar consentimiento real desde la selección actual; no reconstruirlo de proyectos guardados ni autoconfirmar una clasificación incierta. |
| `proposals[].style`, versiones actuales al final del array | `variations[].style_id`, `label`, `current_version_id`, `versions`. Ordenar tarjetas por `position` y buscar la versión por **puntero**; no depender de `at(-1)`. |
| `Version.status === 'pending'` | `version.decision === null` significa pendiente. Mantener decisión separada del estado del trabajo. |
| No hay imagen individual en `Version` | La versión remota tiene `image_url`, `description`, `prompt`, `seed`, `settings`, `provenance`, `created_at`, `size_bytes`, `reason` y `decisions[]`. Usar imágenes reales y conservar trazabilidad. |
| `events[]` planos con UUID local | Cada versión remota incluye su historial `decisions[]` (`version_id`, `decision`, `reason`, `created_at`), sin UUID de evento expuesto. Adaptar las claves de presentación sin inventar IDs de versión o peticiones. |
| `Summary.text`, `acceptedVersionIds`, `rejectedVersionIds` | Texto en **`session.summary.summary`**, con `revision`, `accepted_version_ids`, `rejected_version_ids`, `historical_rejections`. Mostrar solo una revisión vigente. |
| `ready`, `paused`, `completed` | Además: `generating`, `needs_confirmation`, `rejected`, `failed`. Una sesión inicial puede no tener imágenes ni versiones actuales todavía. No pasarla por el validador IndexedDB de demo, que exige cinco versiones existentes. |
| `proposal.generation` | Derivarlo de `jobs` de tipo `regenerate` y su posición. Una sesión puede seguir `ready` con una tarjeta regenerándose. |

Mantener la `seed` del backend como **string**, no convertirla a `number` de JavaScript. El backend puede usar enteros fuera del rango seguro.

Descargar las imágenes mediante `fetch` autenticado, resolver sus rutas contra el origen de la API, convertir los bytes a `Blob` y usar object URLs. Un `<img src="URL_API">` directo no envía el bearer personalizado. Revocar las URLs cuando se sustituye la imagen, al desmontar y al salir de la cuenta.

El resumen remoto conserva `historical_rejections` de eventos anteriores: una versión aceptada puede aparecer allí si antes estuvo rechazada. No confundir ese historial con el estado actual ni reemplazarlo por el cálculo local simplificado de la demo.

## 6. Diferencias abiertas que el agente debe resolver explícitamente

1. **Motivo obligatorio:** el frontend y la petición vigente del usuario lo exigen. En `24374cf`, `DecisionInput.reason` es opcional, hasta 1000 caracteres, y `Sessions.decide` no rechaza un motivo vacío. Mantener el diálogo obligatorio de frontend y acordar la validación equivalente en backend. Hoy el textarea del frontend admite 500 caracteres; no hace falta ampliar ese límite para conectar.
2. **Chat / preferencias después de generar:** el cliente de demo sustituye `preferences` y guarda mensajes localmente. La API actual recibe preferencias al crear la sesión; su `PATCH` solo pausa/reanuda. No existe un endpoint de chat ni de actualización de preferencias. Las regeneraciones reales usan las preferencias originales más el motivo de rechazo. Acordar el comportamiento o ampliar el contrato; no afirmar que el chat ya modifica el prompt remoto.
3. **Clientes y nombres de proyecto:** no están en el esquema de respuesta del backend. Acordar metadatos persistentes o presentar un historial de sesiones identificado de forma honesta mientras se implementan. Evitar que esos nombres desaparezcan al recargar/cambiar de dispositivo sin advertirlo.
4. **Pausa:** la demo permite pausar temporizadores; el backend responde `409` si hay un trabajo activo. Adaptar el botón y explicar el estado, sin prometer cancelación de inferencia que la API no ofrece.
5. **Fuente de verdad:** en modo API, decisiones, versiones, trabajos y resumen pertenecen al servidor. No aplicar `updateProject` para fabricar confirmaciones o `storage.ts` para reconstruir el resumen del LLM. Una caché debe estar separada por cuenta y no revivir datos borrados.
6. **Límites de imágenes:** el backend acepta solo imágenes estáticas y rechaza archivos animados. La validación del navegador de la demo no comprueba animación explícitamente. Mostrar los errores de servidor y conservar la validación de cliente como ayuda, no como autoridad.

## 7. Orden recomendado para conectar

1. Elegir un checkout/rama de integración que contenga frontend y `bedroom-backend`; revisar cambios de `README.md` y plan sin perder decisiones nuevas del frontend. No reemplazar `AGENTS.md` o el frontend por versiones antiguas al incorporar otra rama.
2. Definir tipos de respuesta remota y un cliente API pequeño con URL configurable, bearer vigente, cabecera ngrok, validación de errores y claves de idempotencia. Añadir la configuración pública de Supabase; secretos solo en backend. Mantener la demo separada si se conserva.
3. Implementar acceso con Supabase y la descarga autenticada de original/versiones. Separar y limpiar estado por cuenta.
4. Sustituir el alta simulada por multipart + trabajo inicial. Polling cada pocos segundos mientras `queued/running`; terminar en `succeeded/failed` y recargar sesión. `needs_confirmation` requiere diálogo explícito; `rejected` pide otra foto. No mostrar menos de cinco como lote listo.
5. Sustituir decisiones, reintento por posición y temporizadores por respuestas del servidor. Deshabilitar acciones duplicadas solo donde corresponda. Después de una regeneración, recuperar la versión pendiente y conservar el resto.
6. Recuperar historial y jobs al abrir/recargar; seguir trabajos iniciados antes de cerrar la página. Resolver los metadatos de cliente, preferencias del chat y la diferencia de pausa del apartado anterior.
7. Conectar resumen real y borrado asíncrono. Comprobar revisión antes de mostrar texto. Descartar respuestas que pertenezcan a otra sesión o cuenta.
8. Retirar etiquetas de demo únicamente de capacidades sustituidas por servicios reales. Documentar configuración, resultados, límites y contratos finalmente usados.

### Errores que deben tener recuperación

| Resultado | Tratamiento |
| --- | --- |
| `401` | Renovar sesión Supabase o pedir acceso; no mostrar datos de la cuenta anterior. |
| `404` | Registro/imagen/job no disponible, incluido otro propietario. |
| `409` | Interpretar `detail` y recargar estado: versión obsoleta, acción en curso, pocas aceptaciones o conflicto de idempotencia. |
| `413` / `422` | Feedback de archivo/campos. `detail` puede ser string de aplicación o lista de validación de FastAPI. |
| `503`, desconexión o HTML de ngrok | Mostrar indisponibilidad y conservar el contexto necesario para recuperar; comprobar túnel/salud. No interpretar HTML como JSON ni repetir una escritura incierta con otra clave. |

No usar esperas fijas de 900/1600 ms como sincronización real. Los trabajos pueden tardar minutos y seguir activos aunque la persona cambie de proyecto o cierre la página.

## 8. Verificación y criterio de integración terminada

En la entrega frontend `d6aa5ec` se verificaron **29 pruebas**, TypeScript/build y recorridos de escritorio/móvil. Hay pruebas de las 32 combinaciones de decisión, versiones obsoletas, reintentos, rechazo obligatorio/cancelación, consentimiento por foto, persistencia y recuperación. Ubicación: `frontend/src/{domain,photos,storage}.test.ts` y `frontend/src/ui.test.tsx`. Es evidencia de demo; no demuestra integración remota.

Antes de declarar conectado el producto:

- [ ] `npm test` y `npm run build` pasan; añadir pruebas para los contratos y errores remotos realmente introducidos.
- [ ] Una cuenta A inicia sesión, sube una foto autorizada y ve exactamente cinco propuestas reales y su original.
- [ ] Un resultado incierto pide confirmación; uno que no es dormitorio se maneja sin generar el lote.
- [ ] Rechazar exige motivo, cancelar no cambia nada, confirmar regenera solo ese estilo y conserva IDs/imágenes/decisiones de los otros cuatro.
- [ ] Una petición repetida por pérdida de red no duplica eventos ni trabajos; un job fallido ofrece el reintento correcto.
- [ ] Recargar durante un trabajo recupera sesión y polling; el progreso no depende de una tarjeta montada.
- [ ] Cinco aceptaciones habilitan el resumen real español. Sus IDs, motivos, rechazos históricos y revisión coinciden con el registro. Una decisión posterior invalida la vista anterior.
- [ ] El historial vuelve tras cerrar/reabrir; actualizar el túnel o reiniciar Kaggle conserva las sesiones en persistencia externa.
- [ ] Otra cuenta B recibe `404` para sesiones, jobs y fotos de A; salir de la cuenta limpia la vista y las imágenes privadas.
- [ ] El borrado devuelve estado asíncrono coherente y no resucita desde IndexedDB.
- [ ] Se prueban token vencido, túnel caído, `409`, errores de carga, guardado e inferencia. Se declara qué verificaciones se ejecutaron realmente.

Para backend, seguir su README: Python >=3.11, `uv`, PostgreSQL de pruebas en Docker y `BEDROOM_TEST_DSN` de loopback para la base `bedroom_test`; los tests reinician su esquema. El verificador `backend/kaggle/verify_demo.py` permite comprobar recorrido, aislamiento y recuperación tras reinicio. No ejecutar pruebas que reinicien esquemas contra la base compartida ni comandos `bedroom-purge --apply` como parte de una integración ordinaria.

## 9. Otras referencias y responsables

- **Bianca:** frontend y recorrido con clientes; **Ian:** backend, Kaggle, persistencia y acceso; **Fabryzzio:** SDXL/LoRA y evaluación visual; **Jeffrey:** Qwen/descripciones/resumen. Todo el equipo participa en usuarios, informe y PPT según plan3.
- La rama experimental reporta un LoRA Luxury propio entrenado con 113 fotos, particiones separadas y evaluaciones. Leer sus manifiestos/resultados y sus licencias antes de cambiar pesos. No sustituir automáticamente el catálogo de cinco LoRA fijado en backend ni confundir esos resultados con usabilidad del producto.
- La PoC en [`poc/kaggle_back/`](poc/kaggle_back/README.md) expone `/generate` con una imagen y una descripción y usa Qwen3-VL. No equivale a la API asíncrona de sesiones ni al Qwen3.5 del backend nuevo.
- [`poc/khipu_front/`](poc/khipu_front/README.md) es un chat de texto con JSON `{prompt,max_new_tokens}` y tokens. Su `POST /generate` no es el multipart de imágenes de la PoC ni la nueva API `/api/generations`.
- El [enunciado y la rúbrica](blueprint/enunciado/) determinan la entrega académica. Plan3 incluye evaluación con 10 usuarios, informe, PPT y demo; no presentar cronogramas, metas o resultados de ejemplo como mediciones realizadas.
- Conservar fotografías autorizadas y archivos privados fuera de Git. Los valores de `HF_TOKEN`, `NGROK_TOKEN`, `BEDROOM_DATABASE_URL`, `SUPABASE_SECRET_KEY` y certificados de base pertenecen al entorno del backend. El runbook describe su configuración; esta guía no la aprovisiona.

## 10. Cómo mantener este contexto útil

Cuando cambie el contrato o el despliegue, actualizar esta guía con la revisión consultada, el modo real/demo de cada capacidad, decisiones nuevas y comandos/resultados comprobados. Mantener enlaces a las fuentes sin duplicar archivos de credenciales o informes enteros. No volver a resolver elecciones ya fijadas (dormitorios, cinco estilos, rechazo con motivo y diseño aprobado) salvo una petición nueva del usuario.

Este documento prepara el siguiente trabajo: **no incorpora ramas, no configura Supabase/ngrok y no conecta el frontend por sí solo**.
