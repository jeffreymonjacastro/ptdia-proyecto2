---
name: commit-message-writer
description: >
  Redacta mensajes Conventional Commits a partir de los cambios en staging.
  Úsala al pedir un mensaje de commit, resumir el diff staged o preparar un
  commit. Analiza únicamente el índice de Git y devuelve el mensaje listo para
  copiar; no crea el commit ni incluye atribuciones de IA.
---

# Mensajes de commit convencionales

Genera un mensaje preciso, verificable y listo para usar a partir de los cambios
que estén en staging. La fuente de verdad es el índice de Git, no los cambios
sin stage ni supuestos sobre el proyecto.

## Flujo

1. Comprueba que el directorio es un repositorio Git y que existen cambios staged.
  Usa comandos equivalentes a:

```bash
  git diff --cached --quiet
  git diff --cached --name-status
  git diff --cached --stat
  git diff --cached
```

`git diff --cached --quiet` devuelve `0` si no hay cambios y `1` si los hay.
Si no hay cambios staged, responde únicamente: `No hay cambios en staging para commitear.`

2. Lee el diff y clasifica el cambio principal. Considera el propósito real y
los archivos afectados; no infieras funcionalidad que el diff no demuestra.
3. Elige un scope solo si hay un sustantivo claro que nombre la parte afectada
del código. Omítelo si no añade contexto.
4. Si los cambios staged contienen grupos independientes, recomienda separarlos
en commits y propone un mensaje por grupo. No los fuerces en un único tipo.
5. Devuelve el mensaje sin bloques de código, introducciones, explicaciones ni
metadatos de herramientas.

## Formato

Sigue Conventional Commits 1.0.0:

```text
type[optional scope][optional !]: description

[optional body]

[optional footer(s)]
```

- El prefijo requiere tipo, dos puntos y un espacio. El scope va entre
  paréntesis y es un sustantivo, por ejemplo `fix(parser):`.
- La descripción va inmediatamente después del prefijo, describe el cambio y
  usa voz imperativa. Mantén la primera línea en 72 caracteres o menos como
  convención local de legibilidad.
- Incluye cuerpo solo si aporta contexto que no cabe en el asunto. Debe empezar
  tras una línea en blanco.
- Incluye footers solo cuando el diff o la solicitud los sustenten, por ejemplo
  `Refs: #123`. Cada footer usa `Token: valor` o `Token #valor`; los tokens
  compuestos usan guiones, como `Reviewed-by`.

## Tipo y cambios incompatibles

Usa `feat` para una funcionalidad nueva y `fix` para una corrección de error.
Para los demás cambios, usa el tipo más específico que adopte el proyecto; por
defecto son adecuados:

- `docs`: documentación.
- `refactor`: cambio estructural sin alterar el comportamiento esperado.
- `test`: creación o ajuste de pruebas.
- `ci`: integración o automatización.
- `chore`: mantenimiento, tooling, configuración o dependencias.
- `build`, `perf`, `style` o `revert`: cuando describan mejor el cambio y sean
  coherentes con las convenciones existentes del repositorio.

Si el cambio rompe compatibilidad, indícalo con `!` inmediatamente antes de los
dos puntos (por ejemplo, `feat(api)!: remove legacy endpoint`) o añade el footer
`BREAKING CHANGE: explicación`. `BREAKING CHANGE` siempre va en mayúsculas.
No marques un cambio como incompatible sin evidencia.

## Restricciones de salida

- Prioriza un asunto específico: evita frases vagas como `update stuff`,
  `fix things` o `misc changes`.
- No inventes issues, nombres, impactos, pruebas ni cambios no presentes en el
  diff.
- No incluyas `Co-Authored-By`, `Generated-By`, `AI-assisted` ni ninguna otra
  atribución a IA, salvo que el usuario la pida explícitamente.
- Esta skill redacta el mensaje; no ejecuta `git commit`. Si el usuario también
  solicita crear el commit, pide o espera la autorización aplicable antes de
  realizar esa acción.

Referencia: https://www.conventionalcommits.org/en/v1.0.0/
