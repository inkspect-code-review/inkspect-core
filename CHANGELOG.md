# Changelog

Record every code, fix, documentation, configuration, test and maintenance change
under `Unreleased` with its actual date. Use Added/Changed/Fixed/Removed sections
as appropriate. The package's `0.1.0` version is not a claim of a tagged release.

## Unreleased

### 2026-11-26

#### Added

- Support additional OAuth providers in the authentication factory and recognize X for account linking and remembered sign-ins.

#### Fixed

- Refresh repository connections and findings across tabs when their data changes.

### 2026-11-21

#### Added

- Mark individual, evidence-backed chat findings for task drafts.
- Allow workspace chat to select application-provided product guides alongside scoped project evidence.

### 2026-11-20

#### Fixed

- Check workspace access before handling review, realtime, chat, knowledge and logo requests.

### 2026-11-18

#### Added

- Add optional workspace access and verified connection policies without changing default behavior.

### 2026-11-17

#### Added

- Include open finding counts and severity indicators in review history using stored lifecycle data.
- Forward explicit fix options through the authenticated review route.

#### Changed

- Upgrade Next.js and eslint-config-next to 16.4.6.
- Expand the review model catalog for OpenAI, Anthropic, and Google while preserving existing selections and conservative execution limits.

### 2026-11-15

#### Added

- Remember the last successful sign-in method in a browser cookie, including completed two-factor challenges.

### 2026-11-05

#### Added

- Include the saved pull request title in recent review entries.

- Expose saved pull request titles and support looking up a title for older reviews.

### 2026-11-04

#### Added

- Route instance AI requests through the Inkspect provider when selected at installation (2026-11-04).

- Initial shared authentication, database and domain library source snapshot with independent setup and automated checks.
- MIT license, contribution and community guidelines, security/support policies,
  issue forms, a pull-request checklist and dependency-update configuration.
- Pull-request title validation matching the review engine's commit notation.

#### Changed

- Standardized the initial commit subject and future commit/PR titles as
  `type(scope): short imperative description` (maximum 72 characters).
- Included the approved MIT license and contribution documentation in packaged
  source artifacts; removed the provisional license marker.
