# Contributing guide

[Português (Brasil)](CONTRIBUTING.pt-BR.md)

Thank you for your interest in contributing to Orquestrador Fagulha. This guide explains how to propose changes
so they can be reviewed and merged safely.

By participating, you agree to our [code of conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug:** open an issue with the "Bug report" template.
- **Suggest an improvement:** open an issue with the "Feature request" template before coding, so we can agree on
  the approach.
- **Fix or implement:** pick an issue (those labeled `good first issue` are a good start), comment that you are
  working on it and open a pull request.
- **Add an agent:** new agents can be added through manifests or another extension; see section 4 of
  [docs/ARQUITETURA.md](docs/ARQUITETURA.md).
- **Documentation and translations:** English, Portuguese (Brazil), Spanish and German are supported; corrections
  by native speakers are especially welcome.

Vulnerabilities must **not** be reported in issues; follow the [security policy](SECURITY.md).

## Setting up

Prerequisites: Node.js 20 or later, Git and VS Code 1.95 or later.

```bash
git clone https://github.com/fagulhasoftware/fagulha_orquestrador.git
cd fagulha_orquestrador
npm install
npm run build
npm test
```

Press **F5** in VS Code to open a development window with the extension loaded. To try real agents, use **your
own accounts**; automated tests never use real accounts, keys or network.

## Workflow

1. Fork the repository and create a branch from `main`:
   `git checkout -b fix/short-description` (or `feature/…`, `docs/…`).
2. Keep changes small and focused: one pull request solves one thing.
3. Write or update tests for the changed behavior.
4. Before submitting, run:
   ```bash
   npm run format
   npm run check:webview
   npm test
   npm run package
   ```
   `npm run package` also runs the **privacy check**, which prevents the package from containing personal paths,
   e-mails, keys or local files. It must pass.
5. Open the pull request filling in the template, describing what changed and how you tested it.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), in English:

```
type: short description in the imperative

Optional explanation of why the change was made.
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`.
Example: `fix: reject xlsb spreadsheets before copying the attachment`.

## Project rules

These rules protect users and are not negotiable:

1. **Local data only.** No feature may send user data to Fagulha or third-party servers, or add telemetry.
   Network access only to providers the user configured.
2. **Secrets only in VS Code SecretStorage.** Keys and tokens never go to files, logs, the local database, room
   messages, prompts or the UI.
3. **Every agent action goes through the approval gate.** New tools must declare their action category and follow
   the permission matrix (`src/permissions/matriz.ts`), with tests.
4. **Attachment limits are strict.** Spreadsheets and large files are never read in full.
5. **No native dependencies.** Nothing that requires compiling for VS Code's Electron.
6. **Nothing personal in the repository.** Do not commit files from `~/.orquestra`, `.sqlite` databases, logs,
   `.env`, `.vsix` packages, paths from your machine or real data in tests; use fake data (`@example.com`).
7. **Translations.** User-facing text must exist in every supported language (en, pt-BR, es, de); English is the
   source language.

## UI ↔ extension contract

The UI (`src/webview/`) and the extension host (`src/extension.ts`, `src/core/`, …) talk only through the types in
`src/shared/protocolo.ts`. Changes to that file affect both sides: describe them in the pull request and, if they
change the format of existing messages, bump `VERSAO_PROTOCOLO`.

## Review

A maintainer will review your pull request. We may ask for changes; that is a normal part of the process.
Pull requests that break the project rules will not be merged.

## License of contributions

By submitting a contribution, you agree that it is licensed under the project's [MIT license](LICENSE).
