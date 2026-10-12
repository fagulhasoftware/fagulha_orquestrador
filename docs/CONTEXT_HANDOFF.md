# How decisions survive a context handoff

An old human decision and its rationale do **not** automatically survive a
conversation import. The importer extracts message text and keeps its tail,
up to 12,000 characters. It does not produce a semantic summary, identify
decisions, or prioritize human messages. The character cut can split a message.
For large session files, only the last 8 MB are scanned.

If the rejection and its reason are outside that tail, the receiving agent will
not get them from the import. Resuming a provider's existing session may supply
additional provider-managed context, but the importer does not guarantee that.

## Small example

This is an illustrative project decision, not a claim that the extension
implements the queue in the example:

> Human: Reject an in-memory-only event queue: pending work would disappear
> after a restart. Choose a SQLite-backed queue with idempotent workers.

After many later messages, that statement can fall outside the import budget.
Explicitly record its three parts in project memory using the chat shortcut:

```text
/remember Rejected: in-memory-only event queue. Reason: pending work would be lost after restart. Chosen: SQLite-backed queue with idempotent workers. Revisit only if durability requirements change.
```

For another chat in the same workspace project, the context builder selects
active project/global memories separately from the imported conversation:

```text
Memory of the user (persistent preferences and decisions)
- [project] Rejected: in-memory-only event queue. Reason: pending work would be lost after restart. Chosen: SQLite-backed queue with idempotent workers. Revisit only if durability requirements change.

Imported conversation
...recent messages...
```

The section above is translated for illustration; the current internal prompt
uses Portuguese labels. Importing a session alone does not create this memory.
The user can save it directly; an agent can use `memoria_propor`, which requires
individual approval outside Full mode and saves automatically in Full mode.

## Persistence is different from prompt inclusion

Each memory is limited to 500 characters. Active memories matching the current
workspace project, plus global memories, share a 4,000-character context budget;
newer items are considered first. Older memories remain stored but can be left
out of a prompt. The assembled prompt body also has a 160,000-character tail
limit. There is no pinned-decision guarantee, automatic conflict resolution, or
semantic recovery of omitted rationale.

For a critical or lengthy decision, keep an ADR in the repository with the
rejected option, rationale, chosen alternative, author/date and conditions for
revisiting it. Explicitly ask the receiving agent to read that ADR, or attach an
appropriate extract. A file's existence or a short reference alone does not
guarantee its contents are loaded; attachment and prompt limits still apply.

Implementation: `src/context-import/importador.ts`, `src/core/memoria.ts` and
`src/core/contexto.ts`. Tests in `test/storage-contexto.test.ts` verify recent-text
truncation; `test/chats-memoria.test.ts` covers scope selection, the memory budget
and memory injection into agent prompts.
