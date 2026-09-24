# Roadscanner Repository Security Scanner

Roadscanner can run a read-only, local-first security review of GitHub repositories without cloning or executing the target repository.

## Pipeline

1. **GitHub repository map** — fetch repository metadata, the selected commit tree, dependency manifests, and bounded source files through the GitHub REST API.
2. **Deterministic prefilter** — prioritize security-sensitive paths and detect compact candidate slices with inexpensive rules.
3. **Local Llama triage** — send only candidate slices to Roadscanner's existing local Llama model in one small batch. The repository is never sent wholesale to a model.
4. **Selective large-model validation** — only Medium/High candidates are escalated, with a hard cap. `auto` prefers the configured OpenAI provider and falls back to Grok.
5. **Structured defensive report** — return validated candidates, evidence, impact, remediation, dependency-pin inventory, and token-efficiency/safety telemetry.

Repository content is treated as untrusted data throughout the model prompts. The scanner explicitly instructs models to ignore instructions embedded in source code, comments, strings, and filenames.

## Admin UI

After starting Roadscanner through `repo_scanner:app`, administrators can open:

```text
/admin/repository-scanner
```

The API endpoint is:

```text
POST /api/security/repository-scan
```

JSON body:

```json
{
  "repository": "owner/repository",
  "ref": "main"
}
```

`ref` is optional and may be a branch, tag, or commit SHA.

## Configuration

```text
QRS_REPO_SCANNER_ENABLED=1
QRS_REPO_SCANNER_MAX_FILES=350
QRS_REPO_SCANNER_MAX_FILE_BYTES=163840
QRS_REPO_SCANNER_MAX_CANDIDATES=60
QRS_REPO_SCANNER_MAX_ESCALATIONS=12
QRS_REPO_SCANNER_PROVIDER=auto
```

Optional GitHub authentication:

```text
GITHUB_TOKEN=...
```

`GH_TOKEN` is also accepted. A token increases API rate limits and can allow scanning repositories the token is authorized to read. Use the narrowest read-only token permissions possible for scanner-only deployments.

The scanner reuses Roadscanner's existing model configuration:

- local Llama via `llama_load()`
- OpenAI via `OPENAI_API_KEY`
- Grok via `GROK_API_KEY`

`QRS_REPO_SCANNER_PROVIDER` accepts `auto`, `openai`, or `grok`.

## Current supply-chain stage

The first slice parses Python `requirements*` files and records exact pins versus unpinned dependencies. It does **not** currently call an advisory database or mutate dependency files.

The intended next stage is:

1. correlate exact dependency versions with GitHub Security Advisories / OSV;
2. identify a documented patched version, or a previously used repository version only when evidence supports it;
3. generate a proposed dependency diff;
4. run the proposed diff through the same defensive validation pipeline;
5. create a PR only after an explicit admin write action.

A previous version should never be labeled "known good" merely because it existed in repository history. It needs advisory/test evidence.

## Write and disclosure policy

The current scanner is intentionally read-only:

- it does not clone or execute target repositories;
- it does not run discovered scripts, builds, tests, or proof-of-concept payloads;
- it does not push branches or create PRs;
- it does not publish vulnerability reports automatically.

Future fix-PR support should use a separate GitHub write credential and an explicit admin action. Potential novel vulnerabilities should remain private defensive findings until independently validated and responsibly disclosed.

## Token-efficiency design

The core invariant is:

```text
repository map
    -> deterministic candidate extraction
        -> one compact local-Llama triage batch
            -> bounded Medium/High candidate escalation
                -> structured report
```

The large model never receives the repository wholesale. This makes scan cost scale primarily with suspicious evidence rather than repository size.
