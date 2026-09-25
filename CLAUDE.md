## Releasing

- You have my permission to commit and push directly to `master` in this repo. Don't open PRs unless I ask.
- To release: bump the version in package.json, manifest.json and versions.json (`npm version patch --no-git-tag-version` if the repo has the version-bump script, otherwise edit all three by hand with the same version, no "v" prefix), run the build and tests locally, commit, and push to `master`.
- The Release workflow publishes a GitHub release for any new version automatically; BRAT installs from it. Never push git tags; they're blocked from cloud sessions and aren't needed.
- After pushing, confirm the release exists: https://api.github.com/repos/RMac0001/obsidian-tracker-pro/releases/tags/<version> should return JSON with main.js and manifest.json in "assets".
