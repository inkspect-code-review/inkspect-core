# Inkspect Core

The Inkspect API and dashboard both import `@inkspect/core` for authentication, workspace access and review data. The package exposes individual TypeScript modules through its [exports](package.json).

## How sign-in is assembled

The API and dashboard obtain their Better Auth instance from [the self-hosted runtime](src/self-hosted/auth-runtime.ts). It supplies the PostgreSQL connection pool to [the self-hosted factory](src/self-hosted/auth.ts), which chooses who can create a workspace. The [shared auth factory](src/lib/auth-factory.ts) installs the sign-in methods, session hooks and organization plugin.

To change self-hosted workspace creation, edit `selfHostedAuthPolicy`. To change how a sign-in method works across applications, start in `createEditionAuth`. For reviews, the shared [review handler](src/lib/review-routes.ts) accepts a [review lifecycle](src/lib/review-lifecycle.ts) supplied by the application.

## Run a sign-in test

Use Node.js 22.13 or newer from the package root.

```sh
npm ci
node --import tsx --test tests/app/self-hosted-auth.test.ts
```

The test exercises a magic-link sign-in and workspace creation with an in-memory SQLite database and a local mail stub. Run `npm test` for the full suite, `npm run audit` for package boundaries and `npm run build` for type checking.

To run the dashboard and API together, use the [self-hosted distribution](https://github.com/inkspect-code-review/inkspect).

[MIT license](LICENSE) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Support](SUPPORT.md) · [Security](SECURITY.md)
