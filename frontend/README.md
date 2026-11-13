# Estudio · Frontend de dormitorios

Implementación del **entregable 5 de [plan3](../blueprint/plan/plan3.md)** en React, TypeScript, Vite y Tailwind CSS, siguiendo el [mockup](../blueprint/design/chat-dormitorios-v1.png). Funciona completamente con datos simulados: no necesita FastAPI, Kaggle, ngrok, credenciales ni conexión a servicios de IA.

## Ejecutar

Node.js **22.18 o posterior**.

```bash
cd frontend
npm ci
npm run dev
```

Abre la dirección que imprime Vite (normalmente `http://127.0.0.1:5173`).

```bash
npm test       # reglas del flujo, archivos y persistencia IndexedDB
npm run build  # comprobación estricta de TypeScript y build de producción
npm run preview
```

Después de instalar las dependencias, el recorrido funciona sin Internet. Los recursos visuales y las fuentes del sistema son locales.

## Recorrido disponible

1. Seleccionar un cliente de ejemplo, buscarlo o crear un proyecto con un nombre propio.
2. Usar el dormitorio de ejemplo o subir una foto JPG/PNG/WebP, hasta 10 MiB y 25 megapíxeles. Se comprueban formato declarado, cabecera y decodificación; un archivo renombrado no basta. Confirmar que muestra un dormitorio y autorizar el guardado local.
3. Comparar **Luxury, Japanese, Neo Classic, Attic y Cyberpunk**, ampliar imágenes y ver la fotografía original. Cada propuesta tiene posición, versión y estado visible. Las cinco empiezan pendientes.
4. Añadir un motivo opcional antes de aceptar o rechazar. Un rechazo se conserva en el historial y, tras una breve espera simulada, crea únicamente una nueva versión del mismo estilo, pendiente. Las otras cuatro mantienen su estado. La nueva versión reutiliza la misma imagen ilustrativa.
5. Escribir preferencias en el chat. Se conservan como texto para las próximas versiones, sin alterar propuestas ya aceptadas. La respuesta del asistente es fija y está identificada como demostración.
6. Pausar/reanudar la revisión. Abrir el historial con decisiones, motivos, IDs completos y versiones anteriores.
7. Aceptar las cinco versiones actuales para habilitar el resumen final. Se calcula desde las decisiones, incluye rechazos históricos, no inventa motivos y se invalida al modificar una decisión o versión. Puede copiarse al portapapeles.
8. Recargar para recuperar proyectos, fotos, decisiones y resumen. Eliminar un proyecto borra su registro y la foto del almacenamiento de la demo. Cambiar el nombre del perfil es una personalización local.

## Datos locales y límites de la demo

- IndexedDB guarda una instantánea del espacio y los archivos de fotos como `Blob`, sin Base64 ni envíos al servidor. Usa un solo perfil/pestaña durante la demostración; no hay sincronización entre dispositivos o pestañas.
- Si el navegador no permite guardar, los datos son incompatibles o falta espacio, aparece un aviso. Se mantiene la vista en memoria y se ofrece reintento; los registros incompatibles no se sobrescriben automáticamente.
- El acceso es ilustrativo: **no hay autenticación ni aislamiento privado entre usuarios del mismo perfil del navegador**. No introduzcas contraseñas. Usa fotografías de prueba autorizadas.
- La demo no clasifica habitaciones: solicita confirmación explícita. La detección real de dormitorios corresponde al backend.
- Las cinco imágenes se muestran mediante ventanas SVG del raster de referencia en `public/demo/bedrooms.png`. Son ejemplos ilustrativos del mockup, sin inferencia SDXL ni adaptadores LoRA. La foto cargada no cambia esas imágenes. Las regeneraciones no evalúan calidad visual ni conservación espacial.
- El resumen es determinista y está rotulado como demostración. No llama a Qwen ni demuestra fidelidad de un LLM real.
- Vite sirve archivos estáticos. No hay endpoints `/api`, proxy a túneles antiguos, claves, cuentas remotas, publicación ni backend implementado.

## Organización e integración pendiente

- `src/domain.ts`: contratos locales de proyectos, catálogo, versiones, decisiones y resumen. `updateProject` conserva el historial y descarta acciones con IDs obsoletos o duplicados.
- `src/ProposalCard.tsx`: estados y controles por propuesta; aquí se sustituirá el temporizador de regeneración por el servicio real.
- `src/ProjectForm.tsx`, `src/photos.ts`: carga, validación, confirmaciones y creación de sesión.
- `src/storage.ts`, `src/useWorkspace.ts`: persistencia local y avisos de guardado.
- `src/App.tsx`, `src/components.tsx`, `src/History.tsx`: chat, clientes, galería, diálogos e historial.

Cuando Ian entregue el backend, sustituir la creación local por `POST /api/generations`, las decisiones por `PUT /api/generations/{id}/decisions/{version_id}`, los reintentos por `POST /api/generations/{id}/variations/{position}/retry`, y el resumen por `POST /api/generations/{id}/summary`. Usar las rutas de historial/borrado y la autenticación descritas en plan3. Habrá que acordar el esquema exacto de respuestas y mapear los IDs/versiones del servidor; los IDs de esta demo no constituyen un contrato cerrado de API.

Las pruebas con API real, fallos de túnel, cuentas privadas y persistencia externa del plan permanecen pendientes. La PoC de `poc/khipu_front` y el notebook existente se conservan como referencias independientes.
