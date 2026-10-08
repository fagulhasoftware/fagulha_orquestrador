# Comandos y atajos

[English](COMMANDS.md) · [Português (Brasil)](COMMANDS.pt-BR.md) · **Español** · [Deutsch](COMMANDS.de.md)

Todo lo que puedes escribir, pulsar o configurar en Orquestrador Fagulha, y cuándo usarlo.

## 1. Llamar a los agentes en la sala

| Escribe | Qué ocurre | Cuándo usarlo |
|---|---|---|
| `@claude …` | Envía el mensaje a Claude Code | Planificación, arquitectura, revisiones, explicaciones largas |
| `@codex …` | Envía el mensaje a Codex | Implementación, refactorización, ejecutar y corregir pruebas |
| `@gemini …` (también `@ag`, `@antigravity`) | Envía el mensaje a Gemini CLI | Segunda opinión, investigación, lectura de contexto grande |
| `@ollama …` | Envía el mensaje a tu modelo local de Ollama | Trabajo sin conexión, borradores privados, dudas rápidas |
| `@openai …`, `@anthropic …`, `@geminiapi …`, `@openaicompativel …` | Envía el mensaje a un agente con clave de API | Cuando usas un proveedor con clave de API en lugar de un CLI |
| `@todos …` | Envía el mensaje a todos los agentes habilitados | Pedir la opinión de todos, comparar respuestas |
| Un mensaje **sin** mención | Solo queda registrado en la sala; no se llama a ningún agente | Notas, contexto para después |
| Un agente que escribe `@codex …` en su respuesta | Pasa el turno a ese agente | Los agentes se pasan trabajo (límite: *Traspasos automáticos*, sección 6) |

Consejo: escribe `@` en el cuadro de mensaje para ver sugerencias; ↑/↓ eligen, Enter o Tab insertan, Esc cierra.

## 2. Comandos del chat

| Comando | Qué hace | Cuándo usarlo |
|---|---|---|
| `/detener` (también `/stop`, `/parar`) | Detiene al agente que está trabajando y vacía la cola | El agente tomó un camino equivocado o tarda demasiado |
| `/recordar <texto>` (también `/remember`) | Guarda `<texto>` en la memoria de este proyecto | Decisiones y convenciones del proyecto |
| `/recordar-global <texto>` (también `/remember-global`) | Guarda `<texto>` en la memoria global | Preferencias personales válidas en todos los proyectos |

Nunca guardes contraseñas ni claves en la memoria.

## 3. Teclado

| Teclas | Dónde | Acción |
|---|---|---|
| `Enter` / `Shift+Enter` | Cuadro de mensaje | Enviar / nueva línea |
| `Ctrl+Alt+V` (`Cmd+Alt+V` en macOS) | Con el panel abierto | Iniciar / detener la grabación de voz |
| `1`–`6` / `Enter` / `Esc` | Cuadro de preguntas guiadas | Elegir opción / enviar / omitir |

## 4. Botones de la sala

| Botón | Cuándo usarlo |
|---|---|
| **Detener** | Igual que `/detener` |
| **Nuevo chat** (+) | Empezar una conversación limpia; la actual queda en Chats |
| **Chats y memoria** | Buscar, reabrir, fijar, renombrar, exportar o eliminar conversaciones; gestionar memorias |
| **Agentes** | Habilitar agentes, iniciar sesión, definir rol y modo de permiso |
| **Configuración** | Nivel de permiso, apodo, tema, límites, voz, exportación |
| **Adjuntar** | Adjuntar archivos; también puedes pegar imágenes o arrastrar archivos |
| **Añadir contexto** | Importar una conversación anterior de Claude Code, Codex o una sala |
| **Micrófono** / **Escuchar** | Hablar en lugar de escribir / escuchar una respuesta |
| **Aprobar / Aprobar en la sesión / Denegar** | Decidir sobre una acción de un agente |
| **Responder / Omitir** | Responder a una pregunta del agente; la sala se pausa hasta que respondas |

## 5. Comandos de VS Code (`Ctrl+Shift+P`)

| Comando | Cuándo usarlo |
|---|---|
| `Orquestrador Fagulha: Abrir no editor` | Abrir la sala en una pestaña grande del editor |
| `Orquestrador Fagulha: Falar / parar` | Iniciar o detener la grabación de voz |
| `Developer: Reload Window` | Después de instalar o actualizar la extensión |

## 6. Configuración (`Ctrl+,` → busca "fagulha")

| Ajuste | Predeterminado | Cuándo cambiarlo |
|---|---|---|
| `fagulha.nivel` | `manual` | Nivel de permiso inicial (Total exige confirmación escrita en el panel) |
| `fagulha.passagensAutomaticas` | `6` | Cuántas veces los agentes pueden pasarse el turno; `0` lo desactiva |
| `fagulha.timeoutMinutos` | `20` | Tiempo máximo de una respuesta |
| `fagulha.anexos.*` | ver panel | Límites de adjuntos |
| `fagulha.provedores.*` | detección automática | Ruta de un CLI, modelo o dirección de Ollama / servidores compatibles con OpenAI |

Las claves de API nunca se guardan en la configuración: usa **Agentes → Iniciar sesión**.

## 7. Niveles de permiso

| Nivel | Úsalo cuando |
|---|---|
| **Manual** | Proyectos sensibles o primer contacto: apruebas cada acción |
| **Parcial** (recomendado) | Trabajo diario: libre dentro del proyecto, aprobación para lo demás |
| **Total** | Automatización de confianza aceptando los riesgos mostrados; los comandos externos irreversibles conocidos aún piden confirmación |

## 8. Voz

1. Configuración → Voz → **Descargar e instalar** (una vez, con tu consentimiento).
2. Pulsa el micrófono o `Ctrl+Alt+V`, habla y pulsa **Detener y transcribir**.
3. Di "arroba claude" (o "arroba codex"…) para mencionar a un agente por voz.
4. Activa la **Lectura automática** para escuchar preguntas, anuncios y resúmenes.
