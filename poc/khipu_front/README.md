# Chat local · React + Vite

Requiere Node.js 20.19+ o 22.12+ y el backend activo en `https://throat-pacify-dice.ngrok-free.dev`.

```powershell
cd frontend_test
npm install
npm run dev
```

Abre la URL que indica Vite (normalmente `http://localhost:5173`).

- Una página con historial, envío con Enter y saltos de línea con Shift + Enter.
- `max_new_tokens` editable (128 inicialmente).
- Tokens de entrada, salida y total por respuesta y acumulados de la sesión, tomados del backend; modelo y tiempo por respuesta.
- Historial y tokens guardados en `sessionStorage`: sobreviven a una recarga, se eliminan al cerrar la pestaña o pulsar **Limpiar sesión**. Si el navegador bloquea el almacenamiento, se muestra un aviso.
- El historial es local. Cada POST envía solo el mensaje actual en `prompt`, sin concatenar mensajes anteriores.
- Estados de carga y error; no se suman tokens de peticiones fallidas.

Vite redirige `/generate` a `https://throat-pacify-dice.ngrok-free.dev/generate` mediante un proxy, también en `npm run preview`. El proxy adapta el origen y omite la página de aviso de ngrok. Así el desarrollo local no necesita CORS. En un despliegue estático se debe configurar esa misma ruta en el servidor que sirva el frontend; el proxy de Vite no forma parte de `dist/`.

```powershell
npm test
npm run build
npm run preview
```

Las pruebas usan el runner integrado de Node y un servidor HTTP temporal: verifican el contrato, los acumulados, la recuperación de sesión y los errores. No ejecutan el modelo real.
