# Releasing

Publishing a GitHub Release is what publishes the package to npm. The `Release` workflow (`.github/workflows/release.yml`) runs the full CI, then publishes the exact tarball CI built and tested, through npm trusted publishing with provenance. No npm token is involved.

## Before you start

- Everything you want in the release is merged into `master`, and CI on `master` is green.
- Each merged PR carries a label, because the release notes are grouped by label (see `.github/release.yml`):

  | Label           | Section in the notes |
  | --------------- | -------------------- |
  | `breaking`      | Breaking changes     |
  | `enhancement`   | Features             |
  | `bug`           | Fixes                |
  | `documentation` | Documentation        |
  | `dependencies`  | Dependencies         |
  | anything else   | Other changes        |

  Add a missing label with `gh pr edit <number> --add-label <label>`.

## Choosing the version

The package follows [semantic versioning](https://semver.org):

- **patch** (`1.1.0` → `1.1.1`) for fixes that change no API.
- **minor** (`1.1.0` → `1.2.0`) for new API that is backwards compatible.
- **major** (`1.1.0` → `2.0.0`) for anything that breaks existing callers, including a change to the supported Node.js versions in `engines`.

## Stable release

1. Bump the version on a branch and merge it through a PR:

   ```bash
   git switch master && git pull --ff-only
   git switch -c release-x.y.z
   npm version <patch|minor|major> --no-git-tag-version
   git commit -am "x.y.z"
   git push -u origin release-x.y.z
   gh pr create --fill
   ```

   Use `--no-git-tag-version`: the PR is squash-merged, so a tag created now would point at a commit that never reaches `master`.

2. Once the PR is merged, create the release from `master`. GitHub creates the tag and writes the notes from the merged PRs:

   ```bash
   gh release create vx.y.z --target master --generate-notes --draft
   ```

3. Review and edit the draft on GitHub (Releases page), then press **Publish release**. Publishing starts the `Release` workflow.

   Drop `--draft` in step 2 to publish immediately without reviewing the notes.

4. Follow the run with `gh run watch` or on the Actions tab, then confirm the new version with `npm view catch-chain version`.

## Prerelease

Prereleases are published under the `next` dist-tag, so `npm install catch-chain` keeps resolving to the latest stable version.

1. Bump to a prerelease version in the PR, for example `npm version 1.2.0-rc.0 --no-git-tag-version`, or `npm version prerelease --preid rc --no-git-tag-version` for the next `rc` number.
2. Create the release with the prerelease flag:

   ```bash
   gh release create v1.2.0-rc.0 --target master --generate-notes --prerelease
   ```

3. Users opt in with `npm install catch-chain@next`.

The version and the release's prerelease flag must agree. A version with a `-` suffix must be released with `--prerelease`, and a plain version without it.

## What the workflow checks

Before publishing, the workflow fails the release if:

- typecheck, lint, tests or the build fail;
- the release tag is not exactly `v` followed by the version in the packed `package.json`;
- the prerelease flag does not match the version.

A failed check publishes nothing.

## When something goes wrong

- **A check failed (wrong tag, wrong prerelease flag, red CI).** Nothing reached npm. Release tags are protected and cannot be moved or deleted, so do not try to reuse the tag:
  1. Delete the GitHub Release (the release entry, not the tag) on the Releases page.
  2. Fix the cause in a PR.
  3. Release the next patch version.

- **The publish step failed for a transient reason** (npm outage, network error). Re-run the failed jobs from the run page (**Re-run failed jobs**). The re-run reuses the tarball the original run tested. Do this within 7 days; after that the tarball artifact expires.

- **A bad version reached npm.** npm versions cannot be replaced. Publish a fixed patch version, then deprecate the bad one so installs warn about it:

  ```bash
  npm deprecate catch-chain@x.y.z "Broken release, use x.y.(z+1)"
  ```

  `npm unpublish` is only possible within 72 hours and only if nothing depends on the version. Prefer deprecating.
