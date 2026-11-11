# Backend en Kaggle: SDXL + cinco LoRA + Qwen3-VL

Guía para ejecutar [sdxl_qwen_fastapi_ngrok_lora.ipynb](input/sdxl_qwen_fastapi_ngrok_lora.ipynb) desde el editor de Kaggle. SDXL transforma una imagen con el LoRA seleccionado en la primera GPU; Qwen3-VL describe el resultado en la segunda. FastAPI publica el servicio mediante ngrok.

## 1. Importar el notebook

1. Inicia sesión en [Kaggle](https://www.kaggle.com/) y crea un notebook.
2. En el editor, usa **File → Import Notebook** para cargar `input/sdxl_qwen_fastapi_ngrok_lora.ipynb`.
3. En la configuración de la sesión, activa **Internet** y selecciona **GPU T4 ×2** como acelerador. El código requiere dos GPU: `cuda:0` y `cuda:1`.

## 2. Adjuntar el LoRA

En **Add Input**, adjunta la última versión del dataset [jeffreyamc/plania-p2-jjs-luxury-bedroom-xl](https://www.kaggle.com/datasets/jeffreyamc/plania-p2-jjs-luxury-bedroom-xl).

Contiene cinco archivos: `Attic.safetensors`, `Cyberpunk.safetensors`, `Japanese.safetensors`, `Luxury.safetensors` y `NeoClassic.safetensors`. También están en la carpeta local [dataset](dataset/). El archivo original `JJsLuxuryBedroom_XL.safetensors` ahora se llama `Luxury.safetensors`.

En la sección **3.1** del notebook, cambia esta variable por el nombre exacto del archivo que quieras cargar:

```python
lora_filename = "Luxury.safetensors"
```

Solo se carga un LoRA a la vez. Para cambiarlo durante una sesión, detén el servidor, modifica la variable, ejecuta la celda 3.1 y vuelve a ejecutar la última celda. Ajusta el prompt al estilo seleccionado; para Luxury usa `Luxury Bedroom`.

## 3. Crear los secrets manualmente

Abre **Add-ons → Secrets** en el editor y agrega estos dos secretos:

| Label exacto | Value |
| --- | --- |
| `NGROK_TOKEN` | El authtoken de tu cuenta de ngrok, disponible en [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken). |
| `HF_TOKEN` | Tu token de Hugging Face, disponible en [Access Tokens](https://huggingface.co/settings/tokens), con acceso de lectura a los modelos usados. |

Habilita ambos secretos para este notebook mediante su casilla o interruptor de acceso y guarda los cambios. Los valores se ingresan únicamente en Secrets; no los pegues en las celdas ni en el repositorio.

Kaggle documenta este flujo y la lectura mediante `UserSecretsClient` en su [guía oficial de Secrets](https://github.com/Kaggle/kaggle-cli/blob/main/docs/kernels.md#using-secrets-in-kernels). Cada usuario debe configurar sus propias credenciales.

El notebook lee ambos secretos directamente con `UserSecretsClient`:

```python
secrets = UserSecretsClient()
os.environ["HF_TOKEN"] = secrets.get_secret("HF_TOKEN")
ngrok_token = secrets.get_secret("NGROK_TOKEN")
```

## 4. Ejecutar las celdas

Ejecuta las celdas en orden desde el editor:

1. Instala las dependencias. Si ya habías importado esos paquetes antes de instalarlos, reinicia el kernel y vuelve a ejecutar desde la celda de lectura de secretos.
2. Lee los secretos y verifica que se detecten las dos GPU.
3. Carga SDXL, el LoRA y Qwen3-VL. La primera carga descarga los modelos y puede tardar varios minutos.
4. Ejecuta la definición de la API.
5. Ejecuta la última celda para abrir ngrok e iniciar Uvicorn en el puerto `8000`.

La última celda permanece en ejecución mientras el servidor está activo. Busca en su salida:

```text
API pública: https://<dominio-asignado-por-ngrok>
Formulario: https://<dominio-asignado-por-ngrok>/docs
```

Usa la URL que imprima la sesión actual. El servicio depende de que la sesión de Kaggle y la última celda sigan activas; al detenerlas, deja de estar disponible. La caché de modelos está en `/root/.cache/huggingface` y es temporal.

## 5. Probar el servicio

Abre `https://<dominio-asignado-por-ngrok>/docs`:

1. Ejecuta **GET /health**. La respuesta esperada es `{"status":"ready"}`.
2. En **POST /generate**, pulsa **Try it out**.
3. En `image`, selecciona una imagen de referencia; en `prompt`, escribe, por ejemplo:

   ```text
   Luxury Bedroom, photorealistic interior, beige upholstered headboard, ivory linens, walnut panels, brass sconces, warm indirect lighting.
   ```

4. Pulsa **Execute**. La respuesta contiene `image_base64` (imagen PNG), `image_mime_type` y `description` (descripción en español).

Si eliges Luxury, incluye `Luxury Bedroom` en el prompt para activar su estilo. La API admite imágenes de hasta **10 MiB y 25 megapíxeles**, prompts de **1 a 2000 caracteres** y una generación simultánea. Una segunda solicitud durante una generación recibe HTTP `429`.

## Problemas frecuentes

| Problema | Qué revisar |
| --- | --- |
| Error al leer un secret | Comprueba el nombre exacto (`HF_TOKEN` o `NGROK_TOKEN`) y el permiso de acceso al notebook. |
| Error de dos GPU | Selecciona **GPU T4 ×2** y reinicia la sesión si cambiaste el acelerador. |
| No se encuentra el LoRA | Adjunta el dataset y verifica que contenga el archivo elegido en `lora_filename`. |
| Error al descargar modelos | Comprueba Internet, los permisos de `HF_TOKEN` y el mensaje de Hugging Face sobre el modelo solicitado. |
| La URL deja de responder | Comprueba que la sesión y Uvicorn sigan activos; si reiniciaste, consulta la URL impresa de nuevo. |

El authtoken de ngrok autentica el túnel con tu cuenta. La API del notebook no incorpora autenticación de clientes: quien tenga la URL puede enviar solicitudes mientras esté activa.
