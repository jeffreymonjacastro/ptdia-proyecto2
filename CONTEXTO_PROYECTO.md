# Contexto de PTDIA Proyecto 2 para agentes

Actualizado el **17 de noviembre de 2026**, hora de Lima. Esta guía permite continuar sin el historial del chat. Describe la integración implementada y separa las pruebas locales de la conexión externa pendiente. No contiene credenciales ni presupone que Kaggle/ngrok sigan activos.

## 1. Empezar aquí

1. Leer [AGENTS.md](AGENTS.md) y comprobar `git status --short --branch` antes de modificar archivos.
2. Leer esta guía, [plan3](blueprint/plan/plan3.md), [frontend/README.md](frontend/README.md) y el [mockup aprobado](blueprint/design/chat-dormitorios-v1.png).
3. Para la API usar [backend/FRONTEND.md](backend/FRONTEND.md), [api.py](backend/src/bedroom_backend/api.py), [service.py](backend/src/bedroom_backend/service.py) y el `/openapi.json` del servidor activo. **El contrato ejecutable prevalece sobre las rutas propuestas antiguas del plan.**
4. Consultar [el plan de integración](blueprint/plan/integracion-frontend-backend.md) para el alcance y las verificaciones. No volver a implementar la conexión desde la PoC.
5. Actualizar referencias con `git fetch origin` y revisar cambios posteriores sin sustituir el trabajo local ni volver a revisiones antiguas.

## 2. Rama y estado real

Repositorio: `git@github.com:jeffreymonjacastro/ptdia-proyecto2.git`.

| Rama / revisión observada | Estado |
| --- | --- |
| `feat/frontend-dormitorios` | Rama de trabajo solicitada. Contiene frontend demo y conectado, más el backend fusionado. Conservar esta rama; no fusionar a `main` sin petición. |
| Merge `d08b246` | Incorpora `origin/bedroom-backend` (`24374cf`) a frontend. El conflicto de README se resolvió conservando las guías de ambos módulos. |
| `origin/bedroom-backend`, `24374cf` | FastAPI, PostgreSQL, Supabase Auth/Storage, worker y modelos Kaggle; ya está incorporado en este checkout. |
| `main` observado en `56ffe3f` | Base histórica del blueprint y PoC. No asumir que contiene esta integración. |
| `origin/fabryzzio/sdxl-lora-experiments`, `78dd467` | Experimentos de LoRA/Qwen separados; no se han fusionado como parte de la conexión. |

Historial anterior: `7c46eea` implementó la demo, `805a83a` corrigió persistencia/consentimiento/resumen, `d6aa5ec` hizo obligatorio el motivo de rechazo, `bde40dd` añadió el contexto para agentes. Consultar `git log` para los commits posteriores de integración.

**Decisión explícita del usuario:** usar la API completa de `bedroom-backend`: crear sesión, seguir jobs y recuperar las cinco propuestas. El JSON pegado con `image_base64`, `image_mime_type` y `description`, y el archivo `poc/kaggle_back/response.json`, son referencias de la PoC de una imagen; no son el contrato conectado.

## 3. Producto y decisiones que conservar

La aplicación **Estudio** ayuda a un diseñador a explorar dormitorios con su cliente. Interfaz oscura con proyectos en el lateral, original como adjunto, cinco tarjetas (tres arriba y dos abajo en escritorio), historial y adaptación móvil.

- Alcance exclusivo de **habitaciones / dormitorios**.
- Lote completo de exactamente cinco posiciones: `1 luxury` (Luxury), `2 japanese` (Japanese), `3 neo-classic` (Neo Classic), `4 attic` (Attic), `5 cyberpunk` (Cyberpunk).
- Toda versión nueva empieza pendiente. `decision: null` no es rechazo.
- Las tarjetas renderizan Markdown en las descripciones (negritas, párrafos y listas) mediante `react-markdown`, omitiendo HTML e imágenes incrustadas. Las fotos conservan su descarga autenticada.
- **Rechazar abre diálogo y exige motivo no vacío**, máximo 500 caracteres en la UI. Cancelar/cerrar no registra nada. Confirmar guarda el motivo sobre esa versión y regenera solo su estilo, conservando las otras cuatro propuestas y decisiones.
- Al aceptar el motivo es opcional; no reutilizar un motivo de aceptación como rechazo.
- Conservar original, versiones y decisiones. El backend regenera desde el original con preferencias y feedback; no encadenar por defecto la imagen sintética anterior.
- El resumen requiere cinco versiones actuales aceptadas. Cambiar una decisión/versión invalida la vista anterior. Mostrar texto y registro reales, incluidos rechazos históricos, sin atribuir preferencias inexistentes.
- Conservar el resumen actual y añadir debajo **Diseños aprobados**: cinco miniaturas vigentes con estilo/versión, ampliar, descarga individual y ZIP de las cinco imágenes originales en API. Invalidar el resumen oculta la galería hasta generar otro resumen tras cinco aceptaciones. Demo muestra ejemplos/previews, sin descargas reales.
- No presentar un lote parcial como completo ni aplicar respuestas obsoletas sobre versiones nuevas.
- Cambiar foto exige de nuevo confirmación de dormitorio y autorización; no heredar consentimiento, decisiones ni resumen.
- Conservar el mockup y controles accesibles; distinguir inferencia de simulación. La decoración generada no es un plano constructivo ni garantía de conservación espacial.

Planes 1/2 son antecedentes de flores/personas, no el alcance vigente. El motivo obligatorio es una solicitud posterior al mockup.

## 4. Ejecutar y configurar

Frontend: React, TypeScript, Vite y Tailwind; versiones fijadas en `frontend/package-lock.json`. Node.js **22.18 o posterior**.

```bash
cd frontend
npm ci
npm run dev
# En otra terminal dentro de frontend:
npm test
npm run build
```

El origen de desarrollo es **`http://localhost:5173`**, puerto fijo (`strictPort`), coincidente con la plantilla Kaggle. `127.0.0.1`, otros puertos y `preview` son otros orígenes; deben permitirse explícitamente mediante `BEDROOM_ORIGINS` en backend.

El usuario pidió **`frontend/.env.local`** para introducir sus valores de Supabase; se creó y abrió con ngrok como placeholder. Está ignorado por Git. **No sobrescribirlo ni imprimir sus valores.** La plantilla pública es [frontend/.env.example](frontend/.env.example):

```dotenv
VITE_APP_MODE=api
VITE_API_BASE_URL=https://TU-BACKEND.ngrok-free.app
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

La URL base es el **dominio ngrok sin `/docs`**. El cliente añade `/api/...`. Mientras siga `TU-BACKEND`, no hace llamadas al dominio ficticio y muestra conexión pendiente tras el acceso. Completar URL/publishable key públicas y dominio real cuando estén disponibles; reiniciar Vite si hace falta.

Los `VITE_*` se publican al navegador. Nunca incluir `sb_secret_*`, JWT `service_role`, contraseñas PostgreSQL, `HF_TOKEN`, `NGROK_TOKEN`, claves de servidor ni bearer tokens. La configuración rechaza claves secretas reconocibles, también antes del build. No registrar ni subir fotos o credenciales a Git.

**Modos:** `VITE_APP_MODE=demo` abre la demostración; sin configuración también abre demo, identificada. API parcialmente configurada muestra configuración pendiente y no cae silenciosamente a demo. No migrar/subir proyectos o fotos de demo automáticamente.

## 5. Código conectado y demo

| Archivo | Responsabilidad |
| --- | --- |
| `frontend/src/ConnectedApp.tsx`, `config.ts` | Selección de modo y validación de configuración pública. |
| `frontend/src/AuthStudio.tsx`, `auth.ts` | SDK Supabase, acceso con cuenta precreada, sesión en `localStorage` compartida entre pestañas, renovación y separación por propietario. Salir desmonta el workspace y sus imágenes. |
| `frontend/src/api.ts` | Bearer vigente por petición, un refresco ante 401, cabecera ngrok, multipart, errores HTTP y claves de idempotencia. Transporte configurable para pruebas. |
| `frontend/src/remote.ts` | DTO, validación JSON y adaptación a presentación: IDs opacos, seeds string, puntero actual, jobs, historial y resumen vigente. |
| `frontend/src/useRemoteWorkspace.ts` | Listado/detalle, selección, acciones remotas, polling, recuperación y etiquetas locales por cuenta. Sin IndexedDB de demo. |
| `frontend/src/PrivateImage.tsx` | Descarga Blob autenticada, abort, object URLs y revocación al sustituir/desmontar. |
| `frontend/src/ApprovedGallery.tsx`, `downloads.ts` | Galería posterior al resumen, validación de revisión/IDs y descargas de bytes originales/ZIP usando ImageContext; abort al cambiar o desmontar la selección. |
| `frontend/src/App.tsx` | Shell compartido, estados remotos iniciales, controles de job, pausa, historial y resumen del servidor. |
| `frontend/src/ProjectForm.tsx` | Foto real, preferencias, confirmaciones actuales y creación remota asíncrona; errores sin perder los campos. |
| `frontend/src/ProposalCard.tsx` | Decisiones y motivo obligatorio; estados reales en API. Temporizador de demo desactivado en conectado. |
| `frontend/src/History.tsx`, `components.tsx` | Historial compartido, diálogos, imágenes y controles accesibles. |
| `frontend/src/photos.ts` | JPEG/PNG/WebP, 10 MiB y 25 MP; cabecera y decodificación del navegador. El servidor vuelve a validar y rechaza animación. |
| `frontend/src/domain.ts`, `storage.ts`, `useWorkspace.ts` | Reglas y persistencia de demo. El modo API no ejecuta su resumen determinista ni guarda sesiones privadas aquí. |

La demo conserva cinco clientes e imágenes SVG recortadas del mockup, temporizadores, chat con respuesta fija, resumen determinista y perfil local «Mariana». IndexedDB `ptdia-bedroom-demo`, versión 1, guarda `workspace/current`. No es autenticación ni sincronización multiusuario.

## 6. Contrato remoto vigente

Todas las rutas siguientes requieren bearer; las imágenes también. Se añade `ngrok-skip-browser-warning: true`. Supabase Auth usa cuentas precreadas con `signInWithPassword`; **no existen** `/api/auth/login`, `/register` o `/logout` propios.

| Método y ruta | Uso |
| --- | --- |
| `POST /api/generations` | `FormData`: `image`, `consent=true`, `preferences` opcional hasta 2000 caracteres. `202 {session_id,job_id}`; dejar que el navegador fije boundary. |
| `GET /api/generations` | Historial propio: `id,status,revision,created_at`. |
| `GET /api/generations/{id}` | Detalle de sesión, original, variaciones/versiones, jobs y resumen. |
| `GET /api/jobs/{job_id}` | Progreso/estado `queued,running,succeeded,failed`. Polling cada 2500 ms mientras hay jobs activos; recargar detalle. |
| `GET /api/generations/{id}/original` | Foto original privada. |
| `GET /api/generations/{id}/versions/{version_id}/image` | Imagen privada de una versión. |
| `POST /api/generations/{id}/confirm-bedroom` | Confirmación explícita de clasificación incierta; 202 job. |
| `POST /api/generations/{id}/retry` | Reintento inicial fallido; 202 job. |
| `PUT /api/generations/{id}/decisions/{version_id}` | JSON `{decision,reason?}`; aceptación/no-op 200, rechazo con job 202. |
| `POST /api/generations/{id}/variations/{position}/retry` | Reintento de regeneración fallida; posición 1..5. |
| `POST /api/generations/{id}/summary` | 202 job o 200 resumen vigente guardado. |
| `PATCH /api/generations/{id}` | `{paused:boolean}`; ready/completed/paused, sin jobs activos. No cancela inferencia. |
| `DELETE /api/generations/{id}` | 202 `deleting`; retirar de UI, limpieza asíncrona en servidor. |

Todos los POST y PUT requieren **`Idempotency-Key`**: UUID por intención. El cliente conserva la clave en memoria del API/cuenta tras fallo de red, 5xx o respuesta incompleta, y la reutiliza al repetir esa misma escritura. Éxito confirmado o datos distintos generan clave nueva. No prometer persistencia de esa intención tras cerrar/reabrir el navegador.

Reglas de adaptación:

- `variations` se ordena por `position`; buscar la versión por **`current_version_id`**, no por último elemento del array. IDs/versiones del servidor nunca se fabrican.
- `seed` sigue siendo **string**, puede exceder el rango seguro de JavaScript. `decision:null` es pendiente; estado de job se trata aparte.
- Las versiones incluyen `description,image_url,prompt,settings,provenance,created_at,size_bytes,reason,decisions`. El historial se deriva de eventos reales de versiones.
- El resumen es **`session.summary.summary`** y solo se muestra con revisión e IDs actuales aceptados. `historical_rejections` puede incluir una versión actualmente aceptada con un rechazo previo.
- Además de ready/paused/completed hay generating/needs_confirmation/rejected/failed. Los estados iniciales pueden carecer de versiones: mostrar espera/confirmación/nueva foto/reintento, sin imágenes ficticias.
- Las imágenes se resuelven contra el origen configurado y se descargan con bearer, nunca con un `<img src>` directo al API. Rechazar otro origen antes de enviar credenciales; revocar object URLs al salir.
- Las peticiones privadas bloquean redirecciones, incluido multipart; no reenviar fotos/preferencias a otro dominio aunque un proxy responda 307/308.
- Tras una escritura confirmada se mantiene su job conocido aunque falle la lectura siguiente, para poder recuperar/pollear sin repetir la acción.
- Errores `detail` pueden ser string o lista FastAPI. 401 refresca una vez; 409/413/422 informan el detalle; desconexión/HTML ngrok/503 muestran recuperación sin fabricar éxito.

## 7. Decisiones de integración y límites

- **Cliente/espacio:** el backend no almacena esos campos. Se guardan solo etiquetas en `localStorage bedroom-project-labels:{user_id}` y selección en `sessionStorage bedroom-active:{user_id}`. En otro navegador se identifican sesiones por fecha/ID. Esta limitación figura en la UI/formulario y README; no confundir cliente con propietario autenticado.
- **Chat:** no hay endpoint de chat ni edición posterior de preferencias. La barra conectada indica usar Rechazar con motivo. Las preferencias iniciales y motivos alimentan regeneraciones del servidor. El chat simulado permanece exclusivamente en demo.
- **Rechazo:** la UI exige motivo; el contrato backend fusionado mantiene `reason` opcional (hasta 1000) para otros clientes. No se cambió ese contrato al integrar frontend.
- **Pausa:** se deshabilita durante jobs; el servidor puede responder 409 a un conflicto concurrente. No ofrecer cancelación de GPU.
- **Persistencia:** sesiones/versiones/decisiones/jobs/resumen en servidor; no reconstruirlos con `updateProject`/`buildSummary` ni revivirlos desde IndexedDB. Los jobs continúan con la página cerrada y se recuperan al abrir la sesión.
- **Sesión compartida entre pestañas:** se usa `localStorage` para coincidir con los eventos BroadcastChannel del SDK. Cambiar de cuenta o salir afecta a todas las pestañas del mismo perfil; persiste al reabrir. Una petición de otro propietario se cancela sin cerrar la cuenta nueva. Los fallos transitorios de renovación permiten reintentar sin borrar el acceso.
- **Pendiente menor:** dos pestañas de la misma cuenta pueden sobrescribir el mapa local de etiquetas cliente/espacio. No afecta a fotos, decisiones ni sesiones remotas; mejorar después la escritura por proyecto/sincronización.
- **Configuración externa:** faltan dominio ngrok real y comprobación autenticada en la infraestructura del equipo. El placeholder se conserva a petición del usuario. No afirmar que esta sesión verificó GPU o Supabase reales.

## 8. Backend y operación

[backend/README.md](backend/README.md) describe ejecución, secretos, almacenamiento, Kaggle y verificación autenticada.

- `backend/src/bedroom_backend/api.py`: contratos, CORS y rutas.
- `service.py`, `repository.py`, `worker.py`: idempotencia, PostgreSQL y jobs persistentes.
- `supabase.py`: Auth y bucket privado del servidor.
- `runtime.py`, `models.py`: SDXL y `Qwen/Qwen3.5-4B` en dos T4.
- `catalog.py`, `styles.json`: cinco LoRA y configuración fijada.
- `summary.py`: Qwen elige extractos verificables de pasajes visuales; se filtran introducciones y encabezados antes de seleccionar y validar citas. El servidor construye español con decisiones/motivos.
- `migrations/001_bedroom.sql`, `tests/`, `kaggle/build_bundle.py`, `kaggle/verify_demo.py`: esquema, tests y despliegue.

`GET /health` devuelve `{status:"ready"}` cuando está listo o 503. Revisar `/docs` y `/openapi.json` del dominio activo; `/docs` nunca forma parte de la URL base frontend.

El README backend reporta pruebas anteriores GPU, Supabase/ngrok, reinicio y aislamiento. Son reportes previos del equipo, no verificaciones remotas repetidas en esta integración. Los secretos de backend (`HF_TOKEN`, `NGROK_TOKEN`, `BEDROOM_DATABASE_URL`, `SUPABASE_SECRET_KEY`, certificados) quedan fuera de frontend y Git.

Para pruebas backend usar PostgreSQL **local desechable** y DSN de loopback/base `bedroom_test`: los tests reinician esquema. No ejecutar contra base compartida ni usar `bedroom-purge --apply` como rutina de integración.

## 9. Evidencia y siguientes comprobaciones

Verificado durante esta integración:

- **85/86 pruebas frontend** y `npm run build` pasan, incluidas negritas/listas Markdown, galería aprobada, invalidación, descargas/ZIP y cancelación. Suite API/DTO/controlador/UI, más las reglas, fotos y persistencia demo anteriores. Procesos separados por archivo evitan contaminación entre Happy DOM y FormData nativo.
- Fixture `frontend/src/fixtures/session.json` validado contra el modelo **`SessionDetail`** real del backend.
- **19/19 pruebas backend** con PostgreSQL 17 local desechable. Sin cambios de contrato backend.
- Navegador contra FastAPI/Repository/Worker reales locales, con **Auth e inferencia controladas de prueba**: acceso A, carga, cinco slots, aceptación, rechazo Attic con motivo, Attic V2 conservando las otras cuatro, cinco aceptaciones, resumen del servidor con rechazo histórico, recarga y cuenta B sin proyectos de A. No es evidencia GPU ni Supabase remoto.
- Revisión independiente de la integración completada; corregidos conflictos 409, carreras de historial/cuenta, borrado en estados iniciales, fallos/ACK del resumen, pausa confirmada, redirecciones privadas y borradores separados de aceptación/rechazo mediante 17 regresiones RED→GREEN. El modo sin configuración conserva la demo claramente etiquetada; un API incompleto nunca cae a demo.
- Correcciones previas verificadas con pruebas que fallaron antes: clave ante ACK incompleto, job tras fallo de lectura posterior, imagen sin ruta, botones de imagen anidados y receptor nativo de `fetch` en navegador.

Corrección posterior de resúmenes (backend 0.1.1): la selección y validación usan pasajes visuales sin preámbulos, títulos ni numeración Markdown. Si una descripción solo contiene una introducción, se conserva la decisión y el motivo sin añadir una observación visual. Los resúmenes ya guardados se conservan; el usuario puede borrar el proyecto de prueba antiguo. Verificación posterior: 34 pruebas backend y regresión Qwen real en dos T4 con descripciones sintéticas que contienen el preámbulo. Activar la versión nueva del notebook para comprobar el cambio en sesiones nuevas.

Galería aprobada: navegador con App/ImageContext y datos locales controlados, escritorio y viewport móvil de 390 px; ampliación y descarga real de ZIP con cinco PNG, comprobados por firma y CRC. No se cambió el contrato backend ni se repitió inferencia GPU para esta función.

Pendiente en infraestructura real cuando se rellene la configuración:

- [ ] Cuenta A con Supabase real, foto autorizada, cinco imágenes SDXL y original privado.
- [ ] Clasificación incierta/no dormitorio, imagen inválida y fallos/reintentos reales.
- [ ] Rechazo, regeneración individual, desconexión durante job, recarga y resumen Qwen contrastado.
- [ ] Cuenta B recibe 404 de sesiones/jobs/imágenes de A; token vencido y cierre de sesión limpian vistas.
- [ ] Borrado asíncrono, recuperación tras reiniciar Kaggle/cambiar túnel y CORS exacto.
- [ ] Medir latencias/VRAM/calidad, evaluar con 10 usuarios, informe y PPT según plan3. No marcar mediciones pendientes como resultados.

## 10. Referencias y responsables

**Bianca:** frontend; **Ian:** backend/Kaggle/persistencia/acceso; **Fabryzzio:** SDXL/LoRA/evaluación visual; **Jeffrey:** Qwen/descripciones/resumen. Todo el equipo participa en usuarios, informe y PPT.

- Experimentos: `git show origin/fabryzzio/sdxl-lora-experiments:poc/lora_experiments/README.md`. Revisar manifiestos, licencias y evidencia antes de cambiar pesos; no reemplazar automáticamente el catálogo de cinco estilos.
- [PoC imagen](poc/kaggle_back/README.md): una imagen/descripción y Qwen3-VL; distinta de la API de sesiones y Qwen3.5.
- [PoC texto](poc/khipu_front/README.md): `{prompt,max_new_tokens}`; tampoco es multipart ni `/api/generations`.
- [Enunciado/rúbrica](blueprint/enunciado/) y [plan3](blueprint/plan/plan3.md): fuentes de la entrega académica. Cronogramas/metas no acreditan mediciones.

Mantener este documento al cambiar contrato, modo, despliegue o verificaciones. Anotar lo ejecutado y lo pendiente, sin credenciales ni fotos privadas. No volver a decidir dormitorios, cinco estilos, motivo obligatorio o diseño aprobado salvo nueva petición del usuario.
