# inkspect-core

Shared authentication, models and services. This is a library, not a separately running server.

## Local development

Requires Node >=22.13. Run `npm ci`, `npm run audit`, `npm test`, and `npm run build`.

This checkout installs independently: internal dependencies are versioned source packages in `vendor/`, with integrity recorded in `package-lock.json`. No sibling checkout, symlink, private registry login or original monorepo is needed. They are generated dependency artifacts; edit each dependency in its own repository and rebuild it with `npm run pack`. Never edit installed package copies.

Internal dependencies: none.

Use the main `inkspect` repository to assemble compatible self-hosted releases. Repository privacy and package publication are controlled separately; all new repositories currently remain private. No production deployment is performed by local build/test commands.

Source code is licensed under [MIT](LICENSE). Third-party dependencies retain their own licenses.

## Contributing and community

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, commit notation and
opening a pull request. All changes need an entry in [CHANGELOG.md](CHANGELOG.md).
Follow our [Code of Conduct](CODE_OF_CONDUCT.md), use [SUPPORT.md](SUPPORT.md)
for help, and report vulnerabilities privately using [SECURITY.md](SECURITY.md).
