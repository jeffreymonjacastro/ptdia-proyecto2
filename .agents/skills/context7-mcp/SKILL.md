---
name: context7-mcp
description: Fetch current official documentation and code examples for libraries, frameworks, SDKs, APIs, CLI tools, and cloud services through Context7.
---

# Context7 Documentation Lookup

Use Context7 whenever a task depends on current library or framework documentation rather than model memory.

## When to use

- Setup or configuration questions for a library or framework.
- API and SDK reference questions.
- Version-specific implementation or migration work.
- Code generation that depends on current framework syntax or recommended patterns.
- Library-specific debugging where behavior may have changed between versions.

Do not use it for general programming concepts, business-logic debugging, or refactoring that does not depend on external documentation.

## Workflow

1. Extract the official library name and any version from the task.
2. Call the Context7 library resolver with the library name and the user's specific question.
3. Prefer an exact official match with high source reputation, strong documentation coverage, and a high benchmark score.
4. If the user supplied a version, select a matching version-specific library ID when available.
5. Query Context7 with one focused documentation question at a time.
6. Use the returned primary documentation to implement or answer the task, and mention the relevant version when it affects the result.

## Rules

- Resolve the library ID before querying documentation unless the user already supplied an ID such as `/org/project` or `/org/project/version`.
- Prefer official projects over community forks.
- Do not send credentials, personal data, proprietary code, or other secrets in Context7 queries.
- Keep queries narrow. Split unrelated concepts into separate documentation lookups.
- If current documentation conflicts with repository code or a pinned version, make the conflict explicit before changing behavior.
