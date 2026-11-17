# PTDIA · Proyecto 2

**Estudio** permite explorar cinco estilos de dormitorios, aceptar o rechazar versiones con motivos y recuperar un resumen fiel de decisiones. La rama `feat/frontend-dormitorios` incorpora el backend de `bedroom-backend` y el frontend adaptado a su API de sesiones.

## Arranque del frontend

Requiere Node.js 22.18 o posterior:

```bash
cd frontend
npm ci
npm run dev
```

Abre `http://localhost:5173`. Configura `frontend/.env.local` siguiendo [la guía del frontend](frontend/README.md): URL base ngrok sin `/docs`, URL Supabase y publishable key. El archivo local no se versiona y ngrok puede quedar como placeholder mientras se prepara la conexión. `VITE_APP_MODE=demo` mantiene el recorrido de ejemplo sin backend.

```bash
npm test
npm run build
```

## Backend, contexto y referencias

- [Contrato frontend/API](backend/FRONTEND.md): autenticación Supabase, JSON, imágenes privadas, jobs e historial.
- [Operación backend](backend/README.md): PostgreSQL, Supabase, Kaggle, pruebas y verificación de despliegue.
- [Contexto para agentes](CONTEXTO_PROYECTO.md): decisiones del usuario, implementación, límites y verificación necesaria.
- [Plan vigente](blueprint/plan/plan3.md) y [mockup](blueprint/design/chat-dormitorios-v1.png).
- [`poc/kaggle_back/`](poc/kaggle_back/README.md) y [`poc/khipu_front/`](poc/khipu_front/README.md): prototipos anteriores con contratos distintos; no son la API de sesiones conectada.

Las comprobaciones locales de integración usan datos/inferencia controlados. La disponibilidad de un servidor real, las cuentas de prueba y la URL actual del túnel se verifican por separado; no basta con compilar el frontend para acreditar una demo GPU en vivo.
