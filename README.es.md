# Orquestrador Fagulha

[English](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.md) · [Português (Brasil)](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.pt-BR.md) · **Español** · [Deutsch](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.de.md)

Una sala de chat privada dentro de VS Code donde tus agentes de IA — Claude Code, Codex, Gemini CLI, Ollama
y modelos con clave de API — conversan entre sí y contigo, comparten lo que leen y escriben, y solo actúan
dentro de los permisos que tú definas.

Todo ocurre **en tu computadora**. No hay servidor de Fagulha, ni cuenta de Fagulha, ni sincronización.

## Funcionalidades

- **Una sala por ventana de VS Code**: menciona `@claude`, `@codex`, `@gemini` o `@todos` para llamar a los
  agentes. Un agente puede pasar el turno a otro mencionándolo.
- **Tus agentes, tus inicios de sesión**: entra con tu cuenta de Claude o de ChatGPT en el navegador, o usa
  claves de API (OpenAI, Anthropic, Google AI Studio, servidores compatibles con OpenAI). Las claves se
  prueban con el proveedor antes de guardarse en el almacenamiento seguro de VS Code.
- **Tres niveles de permiso**, elegidos en la primera ejecución:
  - **Manual** — apruebas el 100% de las acciones de los agentes;
  - **Parcial** — libre dentro de la carpeta del proyecto, aprobación para todo lo demás;
  - **Total** — acceso completo; los comandos externos irreversibles conocidos piden confirmación.
- **Modos por agente**: lectura y escritura, solo lectura o solo escritura, además de un rol libre
  (p. ej., "arquitecto", "revisor").
- **Adjuntos**: texto, código, Markdown, imágenes, PDF y Word. Las imágenes llegan a los agentes como
  imágenes. Las hojas de cálculo nunca se leen completas: solo se envían el encabezado y una muestra de filas.
- **Etapas del agente y preguntas guiadas**: sigue lo que hace cada agente y recibe preguntas con respuestas
  sugeridas cuando necesita una decisión; la sala se pausa hasta que respondas.
- **Chat por voz**: habla con la sala por el micrófono y escucha las respuestas. La transcripción
  (whisper.cpp) y la lectura (voz del sistema) se hacen en tu computadora; la grabación se borra después de
  transcribirla. Los componentes de voz se descargan solo con tu autorización.
- **Chats y memoria persistente**: todas las conversaciones quedan en el menú **Chats** (con búsqueda) y
  vuelven al reabrir VS Code; **Nuevo chat** empieza de cero sin perder nada. La **memoria** guarda
  preferencias y decisiones que los agentes reciben en todos los chats.
- **Contexto de otros chats**: importa conversaciones anteriores de Claude Code, Codex u otras salas.
- **Extensible**: nuevos agentes mediante manifiestos u otras extensiones (`FagulhaSoftware.orquestrador-fagulha`).

## Requisitos

- VS Code 1.95 o superior.
- Al menos un agente: [Claude Code](https://code.claude.com), [Codex](https://developers.openai.com/codex),
  [Gemini CLI](https://geminicli.com), [Ollama](https://ollama.com) local o una clave de API compatible.

Orquestrador Fagulha no incluye ni revende acceso a modelos: cada usuario usa sus propias cuentas y paga
directamente a los proveedores, cuando corresponda.

## Instalación

- **Desde el Marketplace de VS Code:** abre Extensiones (`Ctrl+Shift+X`), busca **Orquestrador Fagulha** y
  haz clic en **Instalar**.
- **Desde un archivo `.vsix`:** descárgalo en
  [Releases](https://github.com/fagulhasoftware/fagulha_orquestrador/releases) y usa
  *Extensiones → `...` → Instalar desde VSIX*.

## Primeros pasos

1. Abre **Orquestrador Fagulha** en la barra de actividades.
2. Sigue el asistente: elige los agentes, inicia sesión y define el nivel de permiso.
3. Escribe en la sala mencionando un agente, por ejemplo: `@claude explica la estructura de este proyecto`.

## Comandos y atajos

Todas las menciones, comandos, atajos, botones y ajustes — y cuándo usar cada uno — están en
[docs/COMMANDS.es.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/COMMANDS.es.md). Lo esencial: `@agente` llama a un agente, `@todos` a todos, `/detener`
detiene al agente actual, `/recordar <texto>` guarda una memoria, `Ctrl+Alt+V` inicia la voz.

## Privacidad

- Conversaciones, acciones, aprobaciones y adjuntos se guardan solo en `~/.orquestra/dados`, en tu computadora.
- Las credenciales quedan en el SecretStorage de VS Code y nunca se escriben en archivos, registros ni en la
  base de datos local.
- Sin telemetría. Las únicas conexiones de red son las que tú o tus agentes hacen con los proveedores que tú
  configuraste.

Detalles en [PRIVACY.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/PRIVACY.md) (en inglés).

## Limitaciones conocidas

- Voz: instalación automática de los componentes en Windows; en macOS y Linux el asistente muestra el
  comando para instalar ffmpeg y whisper.cpp.
- Las hojas `.xls`, `.xlsb` y `.ods` se rechazan; conviértelas a `.xlsx` o `.csv`.
- La interfaz está en proceso de traducción; algunos mensajes aún pueden aparecer en portugués.

## Contribuir

¡Las contribuciones son bienvenidas! Lee la
[guía de contribución](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CONTRIBUTING.md) y el
[código de conducta](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CODE_OF_CONDUCT.md).
Las vulnerabilidades se reportan según la
[política de seguridad](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/SECURITY.md), nunca en issues públicos.

## Autoría y licencia

Producto de **Fagulha Software**, construido con Codex (OpenAI) y Claude (Anthropic). Contribución reconocida:
Fagulha Software 50%, Codex 30%, Claude 20% ([AUTHORS.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/AUTHORS.md)).
[MIT](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/LICENSE) © Fagulha. Claude, Codex, ChatGPT, Gemini y Ollama son marcas de
sus respectivos titulares; Orquestrador Fagulha es compatible con estas herramientas, sin vínculo ni respaldo oficial.
