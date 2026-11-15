# SDXL Luxury LoRA: avance y resultados de Fabryzzio

Actualizado: 14 de noviembre de 2026, hora de Lima.

Se completó una primera versión del aporte experimental: preparación de datos,
entrenamiento de un LoRA propio, comparación de parámetros SDXL/Qwen y evaluación
humana. **Entrenar el adaptador está demostrado; que supere generalmente a SDXL
base o preserve siempre la distribución no está demostrado.**

Este directorio contiene código, configuraciones y resultados compactos. Los
pesos, fotografías y generaciones completas están fuera de Git. El notebook
versionado tiene sus salidas eliminadas para mantener pequeño el repositorio;
los JSON conservan evidencia de las ejecuciones realizadas.

## 1. Estado del aporte

| Trabajo | Estado |
|---|---|
| Selección de fotografías y revisión de captions | Completado |
| Entrenamiento de un LoRA propio de SDXL con más de 100 fotos | Completado: 113 fotografías |
| Exportación y comprobación de pesos aprendidos | Completado |
| Comparación SDXL base / LoRA propio / cinco LoRA externos | Completada |
| Sensibilidad de Qwen3.5 en descripción y formato JSON | Completada |
| Comparación sobre diez fotos de validación Luxury | Completada |
| Transferencia desde seis habitaciones sencillas, con dos semillas | Completada, incluidos doce votos A/B |
| Diez fotos de prueba del dataset Luxury | Reservadas, no evaluadas |
| Mejora con nuevos datos, DoRA o ControlNet | Propuesta; no implementada ni evaluada |

El requisito comunicado por el equipo era entrenar al menos un estilo con un
mínimo de 100 fotografías reales y descripciones. Se entrenó el estilo Luxury.
No se entrenó un LoRA de Qwen: se evaluaron parámetros de descripción de imágenes.
Este cierre no acredita el despliegue completo del producto, la fidelidad del
resumen de decisiones de Qwen ni una evaluación de usabilidad de la aplicación.

## 2. Datos: qué fotos se usaron y de dónde proceden

Las fotografías proceden de **Wikimedia Commons**; predominan dormitorios de
hoteles. No se utilizó `interior_style_dataset` para entrenar.

| Conjunto | Fotos | Uso |
|---|---:|---|
| Dataset del estilo: entrenamiento | 113 | Aprender el adaptador |
| Dataset del estilo: validación | 10 | Comparación posterior sobre imágenes no entrenadas |
| Dataset del estilo: prueba | 10 | Reserva; no se generaron resultados sobre esta partición |
| **Total del dataset del estilo** | **133** | **Sólo 113 entraron al entrenamiento** |
| Desarrollo adicional | 3 | Elegir parámetros img2img sobre dormitorios sencillos |
| Transferencia adicional | 6 | Evaluar habitaciones sencillas nuevas con dos semillas |

Las nueve fotos adicionales no forman parte de las 133 ni se usaron para
entrenar. Cada semilla produce otra salida de una misma foto, no otra habitación.

Se revisaron visualmente 950 candidatos para construir el dataset del estilo.
El conjunto final contiene 84 autores y 113 grupos conservadores de escena o
propiedad sin cruce de particiones. Esa agrupación aproxima habitaciones
relacionadas; no demuestra que todos los grupos sean recintos físicamente distintos.
Se revisaron los 133 captions propuestos por Qwen3.5 y se editaron 83.

- [Manifiesto del estilo](data/manifest.csv): fuente, autor, licencia por imagen,
  metadatos de cámara, caption, hash y partición.
- [Captions revisados](data/captions.jsonl).
- [Entradas de desarrollo](data/evaluation_inputs.csv).
- [Manifiesto de transferencia](data/transfer_manifest.csv) y
  [protocolo congelado](data/transfer_protocol.json).

Los metadatos de cámara respaldan la procedencia fotográfica, sin constituir una
garantía absoluta de autenticidad. Las licencias individuales se mantienen; este
repositorio no asigna una licencia nueva a las fotografías. Las seis entradas
de transferencia se seleccionaron antes de ver sus generaciones, con IDs y
autores diferentes y controles de hashes/similitud frente a archivos previos.
Esas comprobaciones tampoco prueban independencia física completa.

## 3. Entrenamiento realizado

| Parámetro | Valor |
|---|---|
| Modelo base | `stabilityai/stable-diffusion-xl-base-1.0` |
| Revisión | `462165984030d82259a11f4367a4eed129e94a7b` |
| Adaptación | Proyecciones de atención del UNet; VAE y codificadores de texto congelados |
| Rank / alpha | 8 / 8 |
| Learning rate máximo | `1e-4`, con 20 iteraciones de calentamiento |
| Actualizaciones reales | 300; ninguna omitida por AMP |
| Microbatch / acumulación | 1 / 2 |
| Fotografías distintas | 113 |
| Exposiciones durante entrenamiento | 600; no son 600 fotografías diferentes |
| Semilla | `20261112` |
| Resolución | Proporción variable, múltiplos de 8; máximo 589.824 píxeles y lado mayor 1024 |
| Precisión | FP16; parámetros entrenables del adaptador en FP32 |
| Activador | `luxbedstyle` |
| Parámetros entrenables | 11.612.160 |
| GPU usada | Una Tesla T4 |
| Bucle de optimización | 737,65 segundos, aproximadamente 12 min 18 s |
| Pico de memoria asignada por PyTorch | 8,14 GiB |

El tiempo excluye descarga, preparación y caché de condiciones. Se cachearon
latentes y embeddings. Sólo se exportó el adaptador aprendido, no el modelo SDXL
completo. Evidencia: [reporte de entrenamiento](results/training.json) y
[verificación de los pesos](results/weights_verification.json).

## 4. Dónde están los pesos y cómo recuperarlos

**Los pesos no están commiteados en esta rama.** El repositorio excluye
`*.safetensors`. Sus referencias y versiones están en [artifacts.json](artifacts.json).

| Dato | Valor |
|---|---|
| Nombre de entrega | `Luxury_UTEC_r8_step300.safetensors` |
| Tamaño | 46.615.272 bytes |
| Kernel | [bedroom-sdxl-luxury-lora-train-v1](https://www.kaggle.com/code/fabryzziomezatorres/bedroom-sdxl-luxury-lora-train-v1) |
| Versión ejecutada satisfactoriamente | 2 |
| Archivo dentro de los outputs | `luxury_lora/pytorch_lora_weights.safetensors` |
| SHA-256 | `aad41fa2c1ab8a7b044a9e3acebb8651f562baa658f72262a99d242e4b5cc05b` |

El kernel y los datasets son **privados**. Jeffrey necesita acceso desde su cuenta
de Kaggle o recibir el archivo por separado. Clonar la rama no concede ese acceso.
Con una cuenta autorizada y Kaggle CLI autenticada:

```bash
kaggle kernels output fabryzziomezatorres/bedroom-sdxl-luxury-lora-train-v1/2 -p artifacts/training --page-size 200 --file-pattern '^luxury_lora/pytorch_lora_weights[.]safetensors$'
```

Se utiliza el archivo de la exportación final, no los checkpoints intermedios.
Verificar su SHA-256 antes de integrarlo. Para un pipeline SDXL img2img ya cargado:

```python
pipe.load_lora_weights(
    "artifacts/training/luxury_lora",
    weight_name="pytorch_lora_weights.safetensors",
    adapter_name="luxury_utec",
)
pipe.set_adapters("luxury_utec", adapter_weights=0.8)
```

Incluir `luxbedstyle` en el prompt. La escala 0.8 y strength 0.75 fueron la
configuración de comparación posterior; no son un óptimo universal ni garantizan
conservación espacial. Mantener el adaptador descargado fuera de Git.

## 5. Experimentos completados

| Experimento | Configuración | Salidas |
|---|---|---:|
| SDXL base | 3 entradas, strengths 0.35/0.55/0.75, semillas 42/123 | 18 |
| LoRA propio | Las mismas entradas y strengths; escalas 0.5/0.8/1.0; dos semillas | 54 |
| Cinco adaptadores externos | 1 entrada, 5 estilos, strengths 0.45/0.65 y escalas 0.6/0.9 | 20 |
| Validación del estilo | 10 entradas ya Luxury, Base frente al LoRA, semilla 42 | 20 |
| Transferencia | 6 entradas sencillas, Base frente al LoRA, semillas 42/123 | 24 |
| **Total SDXL** | | **136** |
| Qwen3.5 | 4 imágenes, siete condiciones por imagen | **28 respuestas** |

SDXL se comparó con 25 pasos y CFG 7.5. Base y LoRA propio comparten entrada,
prompt, semilla, resolución y scheduler para cada par. Se reinicia el generador
en cada llamada. Los cinco adaptadores externos se comprobaron por hash y se
descargó el adaptador activo antes de cargar el siguiente; sus pesos no se
redistribuyen en esta rama.

Qwen: `Qwen/Qwen3.5-4B`, revisión
`851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`. Se probaron greedy con límites
80/160/320 y muestreo con temperaturas 0.3/0.7, top-p 0.9 y dos semillas.

## 6. Resultados y lectura correcta

### Cambiar parámetros

En la muestra de desarrollo, strength produjo cambios mayores que la escala del
adaptador dentro de los rangos estudiados. Con 0.35 hubo cambios pequeños; con
0.75 aparecieron acabados más elaborados y también cambios de ventanas, muebles
y, en un caso, una cama adicional. En el caso de desarrollo votado, Fabryzzio
prefirió Base con strength 0.75 y después el LoRA con strength 0.75 / escala 0.8.

### Validación Luxury y transferencia son pruebas distintas

| Estudio de preferencia Luxury | Base | LoRA | Empate | Ninguna |
|---|---:|---:|---:|---:|
| 10 imágenes que ya eran Luxury; una semilla | 4 | 0 | 6 | 0 |
| 6 habitaciones sencillas; dos semillas, 12 pares A/B | 6 | 2 | 3 | 1 |

La primera ronda no demuestra transformación de habitaciones sencillas: las
entradas ya mostraban el estilo. No se suman los votos de ambas rondas.

La segunda usa etiquetas A/B equilibradas y congeladas antes de inspeccionar
salidas. Se reveló la asignación al cerrar los doce votos y se comprobó su hash.
**Uno de los seis votos de Base es sólo de estilo:** en T05/123 el usuario
prefiere Base para Luxury, pero LoRA para conservar el espacio y no declara un
ganador global. Sin resolver ese compromiso: Base 5, LoRA 2, empates 3, ninguna 1
y un par sin ganador global. Los doce pares pertenecen a seis habitaciones,
no a doce habitaciones independientes.

Observaciones comunicadas por el usuario:

- T03/42, Base: problema espacial y generación mal realizada.
- T04/123, ambos modelos: error percibido al generar una toalla en la cama.
- T05/123: compromiso entre estilo Luxury y conservación espacial.
- T06/123, ambos modelos: transformación insuficiente, descrita como añadir una
  sábana verde doblada al final de la cama.

Detalle en [votos originales](results/human_review.json),
[resumen de transferencia](results/human_review_summary.json) y
[asignación A/B revelada](results/blind_assignment.json).

### Similitud de imagen no equivale a mejor estilo

SSIM/MAE respecto de la entrada describen magnitud del cambio a 256×256. En
transferencia el SSIM medio fue 0.399 para Base y 0.485 para LoRA: el adaptador
cambió menos la apariencia, sin que eso pruebe mejor Luxury o geometría correcta.

La revisión visual del asistente en la validación anterior encontró pérdida de
camas visibles en dos salidas de Base y ninguna del LoRA. Es un recuento visual,
no una validación de dimensiones. Ambos modelos cambian distribución,
proporciones o aberturas. El usuario no calificó geometría para todos los pares:
no se calcula una tasa de conservación a partir de la ausencia de quejas.

### Qwen: contenido y formato

Las 28 respuestas añadieron cercas Markdown: 0 % fue JSON directamente parseable;
retirar únicamente esas cercas permitió parsear el 100 % y verificar el esquema.
Conteo visible de camas y color principal coincidieron con la referencia en la
muestra. Esto no demuestra corrección de todo el caption ni ausencia general de
alucinaciones. Greedy produjo el mismo texto al ampliar el límite de tokens;
el muestreo añadió variación. El orden y calentamiento impiden atribuir las
diferencias de latencia sólo a los parámetros.

## 7. Ubicación del código y orden de ejecución

Cada etapa tiene su carpeta `input/`, script o notebook y `kernel-metadata.json`:

| Etapa | Entrada en el repositorio | Dependencias |
|---|---|---|
| Entrenamiento | [training/input](training/input/) | Dataset del estilo |
| Base | [baseline/input](baseline/input/) | Dataset y entradas de desarrollo |
| LoRA propio | [own_lora/input](own_lora/input/) | Dataset, outputs de entrenamiento y Base |
| Cinco LoRA externos | [pretrained/input](pretrained/input/) | Base y dataset de los adaptadores del equipo |
| Qwen | [qwen/input](qwen/input/) | Dataset del estilo y entradas de desarrollo |
| Validación | [validation/input](validation/input/) | Dataset, entrenamiento y Base |
| Transferencia | [transfer/input](transfer/input/) | Dataset de transferencia, entrenamiento y Base |

Datasets externos referenciados:

- [133 fotos y tres entradas de desarrollo](https://www.kaggle.com/datasets/fabryzziomezatorres/luxury-bedrooms-sdxl-training-v1).
- [Seis entradas de transferencia](https://www.kaggle.com/datasets/fabryzziomezatorres/bedroom-luxury-transfer-eval-v1).
- [Cinco adaptadores externos del equipo](https://www.kaggle.com/datasets/jeffreyamc/plania-p2-jjs-luxury-bedroom-xl).

Los manifiestos de Git no sustituyen las imágenes y scripts adjuntos en los
datasets. El notebook de LoRA propio resuelve el evaluador desde sus inputs de
Kaggle; para cambiar esa receta hay que actualizar también el input que consume.
Las imágenes generadas nombradas en los reportes están en los outputs de Kaggle,
no en `results/` de Git. Los scripts son entradas de Kaggle, no un servicio local
de FastAPI; el backend original del proyecto sigue en `../kaggle_back/`.

## 8. Reproducir o descargar ejecuciones en Kaggle

1. Obtener acceso a los recursos privados y autenticar Kaggle CLI. Los tokens no
   se guardan en el repositorio.
2. Revisar el `kernel-metadata.json` de la etapa. Para ejecutarlo desde otra
   cuenta, cambiar `id` al propietario/slug de esa cuenta y ajustar las
   dependencias privadas o recrearlas bajo esa cuenta. El título debe resolver
   al mismo slug para evitar que Kaggle publique con un nombre inesperado.
3. Activar Internet y GPU T4. La ejecución usa `cuda:0`; esta receta de
   entrenamiento no exige tener dos GPU en uso.
4. Ejecutar entrenamiento y Base antes de las etapas que consumen sus outputs.
   Después de recrearlos, actualizar `kernel_sources` con sus nuevos slugs.
5. Desde la carpeta `input/` de la etapa, publicar y consultar estado:

   ```bash
   kaggle kernels push -p . --accelerator NvidiaTeslaT4
   kaggle kernels status TU_USUARIO/TU_KERNEL
   kaggle kernels output TU_USUARIO/TU_KERNEL -p ../outputs --page-size 200
   ```

   Un push de kernel inicia una ejecución remota y consume recursos GPU. Descargar
   los outputs existentes no vuelve a entrenar.

6. Comprobar tanto el estado remoto como `status` en el JSON de resultados.
   Los scripts guardan reportes de error aunque el kernel termine: `COMPLETE`
   remoto por sí solo no demuestra éxito del experimento.

Entorno medido: Python 3.13, PyTorch 2.11.0, Diffusers 0.42.0,
Transformers 5.20.2, PEFT 0.21.2 y Accelerate 1.15.0. El entorno temporal de
Kaggle requirió retirar `torchao` 0.10 incompatible; los scripts limitan esa
retirada a Kaggle. El evaluador de LoRA instala scikit-image si falta. Estas
versiones son las medidas, no una garantía para cualquier entorno futuro.

Ejecuciones principales:

- [Entrenamiento](https://www.kaggle.com/code/fabryzziomezatorres/bedroom-sdxl-luxury-lora-train-v1), versión 2.
- [Comparación del LoRA propio](https://www.kaggle.com/code/fabryzziomezatorres/bedroom-sdxl-trained-lora-experiments-v1).
- [Validación](https://www.kaggle.com/code/fabryzziomezatorres/bedroom-luxury-heldout-validation-v1), versión 2.
- [Transferencia](https://www.kaggle.com/code/fabryzziomezatorres/bedroom-luxury-transfer-evaluation-v1), versión 1.

## 9. Conclusión y siguientes mejoras

La v1 demuestra entrenamiento propio y comparación reproducible. Base recibió
más preferencias Luxury en esta muestra; el LoRA recibió dos preferencias
favorables en transferencia y conserva mejor ciertos elementos en casos
concretos. No existe aquí una configuración validada que logre simultáneamente
Luxury y conservación espacial en todas las entradas.

Las principales limitaciones son el tamaño de muestra, predominio hotelero,
un evaluador y sólo dos semillas en transferencia. Las fotos de prueba del
estilo permanecen reservadas. Después de usar estos casos para mejorar el
modelo, no se deben reutilizar como prueba final independiente. Las imágenes
generadas son referencias visuales, no planos constructivos.

Para una v2 se propuso mejorar la definición y selección de Luxury, ampliar
fotografías con permisos apropiados y revisar captions; después comparar un
LoRA mejor ajustado con DoRA. El control espacial mediante ControlNet sería un
experimento separado, con el mismo control aplicado también al modelo base.
Ninguna de esas mejoras está ejecutada ni garantiza superar el baseline.
