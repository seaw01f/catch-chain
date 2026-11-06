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

## Choosing the version

The package follows [semantic versioning](https://semver.org):

- **patch** (`1.1.0` → `1.1.1`) for fixes that change no API.
- **minor** (`1.1.0` → `1.2.0`) for new API that is backwards compatible.
- **major** (`1.1.0` → `2.0.0`) for anything that breaks existing callers.

## Stable release

Replace `x.y.z` with the new version, for example `2.0.0`.

1. Start from an up-to-date `master` and create a release branch:

   ```bash
   git switch master && git pull --ff-only
   git switch -c release-x.y.z
   ```

2. Pick the next version. This updates `version` in `package.json`, for example from `1.1.0` to `2.0.0` for `major`:

   ```bash
   npm version <patch|minor|major> --no-git-tag-version
   ```

   Use `--no-git-tag-version`: the PR is squash-merged, so a tag created now would point at a commit that never reaches `master`.

3. Commit the change, push the branch and open the PR:

   ```bash
   git commit -am "x.y.z"
   git push -u origin release-x.y.z
   gh pr create --fill
   ```

4. Merge the PR once CI is green (squash).

5. Create a draft release from `master`. GitHub creates the tag and writes the notes from the merged PRs:

   ```bash
   git switch master && git pull --ff-only
   gh release create vx.y.z --target master --generate-notes --draft
   ```

6. Edit the draft on GitHub (Releases page). The generated notes only list PR titles, so for a major release put the breaking changes at the top, each with what callers need to change.

7. Press **Publish release**. This starts the `Release` workflow, which publishes to npm. Publishing is hard to undo: npm only allows unpublishing within 72 hours, and a version number can never be reused.

8. Confirm with `gh run watch`, then `npm view catch-chain version`, which should print the new version. npm can take a few minutes to show it after the workflow finishes.

### Example: releasing 2.0.0

```bash
# Start from an up-to-date master
git checkout master && git pull --ff-only

# Create a release branch
git switch -c release-2.0.0

# Pick the next version: changes package.json from 1.1.0 to 2.0.0
npm version major --no-git-tag-version

# Commit, push the branch and open the PR
git commit -am "2.0.0"
git push -u origin release-2.0.0
gh pr create --fill

# Merge the PR once CI is green (squash)

# Create a draft release from master
git switch master && git pull --ff-only
gh release create v2.0.0 --target master --generate-notes --draft

# Edit the draft on GitHub (Releases page): put the breaking changes at the top,
# because the generated notes only list PR titles

# Press Publish release: this starts the Release workflow, which publishes to npm.
# Publishing is hard to undo - npm only allows unpublishing within 72 hours,
# and the version number can never be reused.

# Confirm the run, then the published version (prints 2.0.0)
gh run watch
npm view catch-chain version
```

## Prerelease

Prereleases are published under the `next` dist-tag, so `npm install catch-chain` keeps resolving to the latest stable version. Replace `x.y.z-rc.n` with the prerelease version, for example `2.1.0-rc.0`.

1. Start from an up-to-date `master` and create a release branch:

   ```bash
   git switch master && git pull --ff-only
   git switch -c release-x.y.z-rc.n
   ```

2. Pick the prerelease version. Name it for the first release candidate, or let npm count up from the current one:

   ```bash
   npm version x.y.z-rc.0 --no-git-tag-version              # first candidate, for example 2.1.0-rc.0
   npm version prerelease --preid rc --no-git-tag-version   # next candidate, for example 2.1.0-rc.0 to 2.1.0-rc.1
   ```

3. Commit the change, push the branch and open the PR:

   ```bash
   git commit -am "x.y.z-rc.n"
   git push -u origin release-x.y.z-rc.n
   gh pr create --fill
   ```

4. Merge the PR once CI is green (squash).

5. Create a draft prerelease from `master`:

   ```bash
   git switch master && git pull --ff-only
   gh release create vx.y.z-rc.n --target master --generate-notes --prerelease --draft
   ```

   The version and the release's prerelease flag must agree: a version with a `-` suffix must be released with `--prerelease`, and a plain version without it. The workflow refuses a mismatch.

6. Edit the draft on GitHub (Releases page) and press **Publish release**. This starts the `Release` workflow, which publishes to npm under `next`. The version number can never be reused, so the next candidate needs the next `rc` number.

7. Confirm with `gh run watch`, then `npm view catch-chain dist-tags`, which should show the new version under `next`. Users opt in with `npm install catch-chain@next`.

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
