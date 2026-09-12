# PR Review Checklist

## 1. Security & Credentials (Mandatory)
- [ ] No AWS Access Keys (`AKIA...`, `ASIA...`) or Secret Access Keys.
- [ ] No AWS Session Tokens or temporary STS credentials.
- [ ] No private keys (`*.pem`, `*.key`, `id_rsa`).
- [ ] No personal tokens (`ghp_...`), passwords, or API keys.
- [ ] No `.env` files or local configuration containing sensitive endpoints.
- [ ] No company backup or recovery files (`RESTORE*`).

## 2. Competition Rules Compliance
- [ ] No hardcoded private/sensitive datasets violating contest rules.
- [ ] No wide-open security group configurations.
- [ ] Respects AWS designated deployment regions (`us-east-1`, `us-west-2`).

## 3. Code Quality & Architecture
- [ ] Clear commit message and PR description explaining "What" and "Why".
- [ ] Does not break existing UI layout, styling, or interactions in `preview.html`.
- [ ] Relative asset references (`assets/...`) remain valid.
- [ ] JavaScript syntax is valid and free of unhandled exceptions.

## 4. CI/CD & Deployability
- [ ] Automated tests or CI checks (if configured) pass.
- [ ] Mergeable with `main` without merge conflicts.
- [ ] Ready for deployment via `deploy_*` tag trigger.
