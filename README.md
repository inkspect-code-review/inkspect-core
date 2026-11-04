# inkspect-core

Shared authentication, models and services. This is a library, not a separately running server.

## Local development

Requires Node >=22.13. Run `npm ci`, `npm run audit`, `npm test`, and `npm run build`.

This checkout installs independently: internal dependencies are versioned source packages in `vendor/`, with integrity recorded in `package-lock.json`. No sibling checkout, symlink, private registry login or original monorepo is needed. They are generated dependency artifacts; edit each dependency in its own repository and rebuild it with `npm run pack`. Never edit installed package copies.

Internal dependencies: none.

Use the main `inkspect` repository to assemble compatible self-hosted releases. Repository privacy and package publication are controlled separately; all new repositories currently remain private. No production deployment is performed by local build/test commands.

Licensing is pending owner approval. `LICENSE.proposed` is a draft; this snapshot is not yet a public open-source release.
