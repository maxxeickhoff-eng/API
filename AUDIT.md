# Publication Audit: Showboard (TVmaze API)

This file records the publication audit for this project:

- what was checked
- what was found
- which findings needed action
- what was fixed
- what remains open

It is sanitized: no secret values or personal contact details appear here.

| | |
|---|---|
| Tool | Claude Code (AI coding assistant), run from this project's root folder |
| Prompt | The audit prompt from the course submission guidelines (unchanged) |
| Audit 1 | 2026-11-25, read-only (no files changed, no code run, nothing committed) |
| Fixes | 2026-11-25, after reviewing the findings |
| Audit 2 | 2026-11-25, the same checks repeated after the fixes |

## What was checked

| Area | How |
|---|---|
| Git status | `git status --ignored`: tracked, untracked and ignored files |
| Tracked files | Every tracked file listed with its size and reviewed |
| Secrets | Pattern scan of every file and **every commit**. It covered API keys (Supabase, GitHub, AWS), JWTs, private keys, and words like "password", "secret", "token" and "api key". It printed file names only. |
| Personal data | Scan for email addresses, local user paths and real names. Commit author and committer metadata. Metadata chunks inside every PNG image. |
| Exclusions | `git check-ignore` on typical local files: `.env` variants, editor folders, `.DS_Store`, logs, packaged files |
| Dependencies and config | Whether anything must be installed or configured (API key, `.env`) |
| Code safety | Where API data ends up in the page (`innerHTML`, links, image sources, CSS) |
| External resources | Which hosts the page loads data from |
| Licences | Licence of the code, and the licence and attribution required for the TVmaze data |
| README | Checked against the required sections: purpose, data collection, persistence, user interaction, setup, learning, limitations and assistance |

## Audit 1: findings and decisions

"Confirmed" means the issue was verified in the files or the history. "Possible concern" means it depends on context or a judgement call.

| # | Finding | Type | Action needed? | Decision |
|---|---|---|---|---|
| 1 | No secrets in the files or the history. The app needs no API key and no `.env`. | Confirmed (OK) | No | — |
| 2 | The words "secret" and "token" matched in `.gitignore` (a comment) and `styles.css` (the comment "Theme tokens"). | Confirmed false positive | No | — |
| 3 | No personal email addresses; the only commit uses the GitHub `noreply` address. | Confirmed (OK) | No | — |
| 4 | Links and images taken from API data were used without checking them: the official site link, the TVmaze link, the poster, the backdrop in a CSS `url()`, and the cast photos. A manipulated value such as `javascript:…` would end up in a clickable link. | Confirmed | **Yes** | Fixed |
| 5 | No `LICENSE` file, so others may not legally reuse the code. | Confirmed | **Yes** | Fixed (MIT) |
| 6 | The README setup used placeholders (`<your-username>/<this-repository>`) that don't work when copied. | Confirmed | **Yes** | Fixed |
| 7 | `docs/ratings.png` contained an EXIF block, added by the image cropping tool. It only held the colour space and the image size, nothing personal. | Confirmed (harmless) | Yes, as a precaution | Fixed: the block was removed |
| 8 | API summaries arrive as HTML. Checked: they are converted to plain text, and the page never uses `innerHTML`. | Confirmed (OK) | No | — |
| 9 | TVmaze data is licensed CC BY-SA 4.0. Checked: the footer credits TVmaze with links to the API and the licence. | Confirmed (OK) | No | Also mentioned in the README licence section |
| 10 | The screenshots in `docs/` show show posters, which belong to their studios. | Possible concern | No | **Accepted.** They are small screenshots of the app for documentation, and the README says who owns them. |
| 11 | `.gitignore` doesn't cover `node_modules/` or packaged files. | Possible concern | No | **Not relevant:** the project has no dependencies and no build step |
| 12 | There are no automated tests. | Possible concern | No | Documented under Limitations; the app was tested by hand |

## Fixes made

| Finding | Fix | File |
|---|---|---|
| 4 | Added `safeUrl()`. Every link and image address from the API must be a normal `http`/`https` address, otherwise it is not used. The backdrop URL is inserted into CSS safely quoted. Re-tested afterwards: `javascript:` and `data:` addresses are rejected, and normal links (including the `http://` official site of *Breaking Bad*) still work. | `app.js` |
| 5 | Added the MIT licence, plus a licence section in the README that separates the code licence from the TVmaze data licence | `LICENSE`, `README.md` |
| 6 | Setup now says to copy the address from the green **Code** button; the server command no longer needs a folder name | `README.md` |
| 7 | Removed the EXIF chunk from the PNG without changing the image | `docs/ratings.png` |

## Audit 2: re-check after fixes

| Check | Result |
|---|---|
| Secret patterns in the files to be published and in all commits | None found |
| Email addresses, local user paths, real names | None. The only name is the public GitHub username in `LICENSE`. |
| Commit emails | Only the GitHub `noreply` address |
| Links and images built from API data | All go through `safeUrl()`; no `innerHTML` anywhere |
| `LICENSE` | Present (MIT) |
| README placeholders | None left |
| PNG metadata | Only image chunks (`IHDR`, `sRGB`, `IDAT`, `IEND`) |
| `.env`, `.DS_Store`, editor folders, logs | Ignored |
| README sections | All seven required sections present, and their claims match the code |

## Remaining items

- [ ] **Make the repository public** and check that it opens while logged out of GitHub.
- [ ] Optional: switch on GitHub Pages (Settings → Pages → `main` / root) for a live demo link.

## What could not be verified

- **The repository on GitHub itself:** visibility, branches, other settings. It hadn't been pushed at the time of the audit.
- **Data from TVmaze:** whether every image and text TVmaze returns is correctly licensed. The app relies on TVmaze's own licensing.
- **Other browsers:** the app was tested in Chrome only (desktop and phone size). Firefox and Safari were not tested.
- **Secrets in formats** that the pattern scan doesn't cover.

Finding no issues in an automated scan does not prove the project is safe.
