---
name: git-change-publisher
description: >
  Revisa cambios, los añade a staging, crea un Conventional Commit y publica la
  rama. Úsala cuando el usuario pida preparar, commitear y hacer push de cambios;
  crea un Pull Request solo cuando se solicite o sea necesario para integrar una
  rama no predeterminada.
---

# Publicar cambios con Git

Gestiona el ciclo completo de una entrega Git: inspeccionar, añadir los archivos
en alcance, crear un commit coherente y publicar la rama. Ejecuta operaciones
mutantes únicamente cuando el usuario haya pedido publicar, commitear o hacer
push; una consulta sobre el estado del repositorio no autoriza esas acciones.

## Dependencia para el mensaje

Antes de crear cada commit, lee y sigue
[`../commit-message-writer/SKILL.md`](../commit-message-writer/SKILL.md). Esta
skill es la fuente de verdad para analizar el diff staged y redactar el mensaje
Conventional Commit. No añadas atribuciones de IA ni cambies sus reglas de
formato.

## Flujo de publicación

1. Verifica que el directorio es un repositorio Git, que `HEAD` no está
   desacoplado y que hay una rama actual. Inspecciona `git status --short`, la
   rama, su upstream y los remotos antes de mutar nada.
2. Revisa el diff sin staging y el staged, incluidos nombres de archivos y
   `git diff --check`. No continúes si hay errores de espacios, marcadores de
   conflicto, secretos aparentes o archivos no relacionados con la solicitud.
   Explica qué requiere decisión del usuario.
3. Añade solo los archivos que correspondan a la solicitud mediante
   `git add -- <rutas-explícitas>`. No uses `git add .` ni `git add -A` cuando
   puedan incluir cambios ajenos, archivos generados o secretos. Vuelve a
   inspeccionar el diff staged.
4. Aplica `commit-message-writer` al contenido staged. Si hay grupos
   independientes, no los combines ni modifiques el índice para separarlos sin
   autorización explícita: informa los grupos y pide cómo proceder. Para un
   grupo coherente, crea el commit con el mensaje resultante.
5. Comprueba que el árbol de trabajo quedó limpio respecto de los archivos en
   alcance. Ejecuta las validaciones o pruebas que la solicitud o el repositorio
   exijan antes de publicar; no inventes una prueba ni declares éxito si no se
   ejecutó.
6. Haz push al upstream configurado. Si no existe, usa `origin` y configura el
   upstream de la rama actual solo si ese remoto existe y el usuario pidió
   publicar esa rama.
7. Al completarse el push, informa de forma explícita el nombre completo del
   commit, su SHA corto y el destino remoto. Usa este formato:

   ```text
   Push completado: <rama> -> <remoto>/<rama>
   Commit publicado: <mensaje completo> (<sha-corto>)
   ```

## Rechazos de push y conflictos

Si el push es rechazado porque el remoto avanzó:

1. Ejecuta `git fetch <remoto>` e inspecciona la divergencia y el historial.
2. Con árbol limpio y upstream conocido, integra con `git pull --rebase` sobre
   esa rama. Si termina correctamente, vuelve a ejecutar el push una sola vez.
3. Si surge un conflicto, no elijas una resolución por cuenta propia, no hagas
   `push --force` y no continúes el rebase. Informa los archivos en conflicto,
   el estado actual y que se necesita una decisión humana sobre su contenido.

No sobrescribas historial remoto, no uses `--force`/`--force-with-lease` y no
crees commits de merge automáticos como alternativa a un conflicto. Si el
rechazo tiene otra causa (permisos, regla de rama protegida, autenticación o
hook), muestra el error accionable y detente.

## Pull Requests

Un Pull Request no equivale a `git pull`. Créalo solo cuando el usuario lo haya
pedido o cuando la rama publicada sea distinta de la rama predeterminada y el
flujo de integración del repositorio lo requiera.

- Detecta la rama predeterminada desde `origin/HEAD` o la configuración del
  proveedor. No la supongas.
- En un remoto compatible con GitHub, usa `gh` únicamente si está disponible y
  autenticado. Primero comprueba si ya existe un PR abierto para la rama.
- Si no existe, crea un PR hacia la rama predeterminada con un título derivado
  del commit y una descripción fiel al diff; no inventes cambios, resultados de
  pruebas ni referencias.
- Si faltan proveedor, autenticación, base o permisos, no simules la creación:
  informa el requisito exacto y detente después del push exitoso.
- Al crearlo o detectarlo, incluye su URL en el resultado final.
