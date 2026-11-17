# Integración del frontend con Bedroom Backend

> Ejecutar con `superpowers:executing-plans`. Solicitud aprobada: incorporar `bedroom-backend` a `feat/frontend-dormitorios`, configurar URLs y adaptar el frontend a los JSON del backend.

**Objetivo:** usar la interfaz aprobada con autenticación Supabase, sesiones, trabajos, imágenes privadas, decisiones y resumen del backend real; conservar la demo de forma explícita.
**Fuentes:** `backend/FRONTEND.md`, `backend/src/bedroom_backend/api.py`, `service.py`, `CONTEXTO_PROYECTO.md`, `blueprint/plan/plan3.md` y mockup aprobado.
**Estado inicial:** frontend `bde40dd`, backend `24374cf`; merge local `d08b246`. Sin credenciales ni URLs de conexión configuradas en el checkout.

## Condiciones globales

- Cinco estilos existentes; rechazo con motivo obligatorio y confirmación; conservar las otras cuatro versiones.
- El servidor es la fuente de verdad de sesiones, decisiones, versiones, trabajos y resumen. No fabricar resultados remotos con temporizadores ni con `buildSummary` de demo.
- Cada POST/PUT lleva una clave de idempotencia estable al reintentar la misma escritura incierta. El bearer se obtiene de la sesión vigente; nunca se envía a otro origen.
- Respetar `current_version_id`, pendientes representadas por `decision: null`, seeds string y `summary.summary` solo para la revisión actual.
- La foto/consentimiento actuales se envían por multipart. No subir automáticamente proyectos o fotos de la demo.
- Metadatos de cliente/espacio permanecen locales por cuenta hasta que exista un contrato remoto. El chat no debe prometer cambiar preferencias remotas cuando no hay endpoint para ello.
- URLs y publishable key por configuración pública; secretos de servidor fuera del frontend y de Git.

## Riesgos a verificar

Token renovado o cuenta cambiada; respuesta obsoleta; imagen privada fuera del origen configurado; lote parcial; reintento de escritura incierta; jobs activos tras recargar; resumen anterior a una decisión; autorización de otra foto; pausa no permitida durante inferencia.

## Tarea 1 — Contrato JSON y cliente HTTP

Archivos: `frontend/src/api.ts`, `frontend/src/api.test.ts`, `frontend/src/remote.ts`, `frontend/src/remote.test.ts`, fixtures JSON de pruebas.

- [x] Escribir pruebas del JSON real, puntero de versión, pending/null, seed grande, resumen obsoleto y lote incompleto. Ver fallos.
- [x] Implementar tipos y conversión al modelo de presentación existente sin persistir datos remotos en IndexedDB de demo.
- [x] Probar headers, multipart, idempotencia tras fallo, JSON de errores y rechazo de imágenes fuera del origen. Ver fallos e implementar cliente.
- [x] Ejecutar suite frontend.

## Tarea 2 — Acceso y recorrido remoto en la interfaz aprobada

Archivos: `frontend/src/ConnectedApp.tsx`, `frontend/src/useRemoteWorkspace.ts`, componentes existentes, configuración de ejemplo y pruebas de UI.

- [x] Añadir Supabase Auth y modo configurado; conservar sesión vigente y limpiar estado/imágenes al cambiar de cuenta o salir.
- [x] Reutilizar formulario, tarjetas e historial para subir foto real, consultar sesiones, aceptar/rechazar con motivo, polling, reintento, confirmación de dormitorio y resumen real.
- [x] Usar descargas Blob autenticadas y revocar URLs. Deshabilitar pausa durante jobs y controles de tarjeta durante escritura/inferencia.
- [x] Resolver alta/errores sin perder el motivo ni repetir acciones. Recuperar sesiones/jobs tras recargar.
- [x] Probar consentimiento actual, estados iniciales sin imágenes, errores HTTP y limpieza de cuenta; suite + build.

## Tarea 3 — Verificación y documentación

- [x] Probar backend con PostgreSQL local desechable, sin tocar infraestructura compartida.
- [x] Verificar frontend con JSON y transporte controlados y recorrido en navegador; si hay configuración real, consultar salud/contrato y distinguir verificaciones autenticadas disponibles de las pendientes.
- [ ] Revisión independiente de toda la integración y una pasada de correcciones con pruebas.
- [ ] Actualizar guías y contexto, commit/push de la rama solicitada sin fusionarla a main.

## Evidencia local

55 pruebas frontend y build pasan; fixture contrastado con SessionDetail; 19 pruebas backend sobre PostgreSQL desechable. Recorrido con FastAPI/worker locales y Auth/inferencia controladas: carga, cinco propuestas, rechazo con motivo y regeneración individual, cinco aceptaciones, resumen persistido tras recarga y cuenta B sin sesiones de A. Supabase/ngrok/GPU reales pendientes de configuración.
