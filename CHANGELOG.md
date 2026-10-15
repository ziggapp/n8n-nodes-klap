# Changelog

## 0.2.0

- Project → Create can wait for the clips: **Wait for Clips** polls the project until Klap is done, then outputs one item per clip, best first, each with a `preview_url` to watch or embed it. A form, Project → Create and a final page are now a whole workflow, with no trigger or second workflow.
- Wait for Clips is on by default in the Klap node's new version 1.1. Existing workflows keep version 1, which returns the project right away as before.
- **Timeout (Minutes)**, 60 by default: past it, the node fails with the project ID and the project keeps going in Klap. A project Klap couldn't clip, or one with no clips, fails with the reason.

## 0.1.2

- Package author email is now team@klap.app. No functional changes.

## 0.1.1

- Published from GitHub Actions with npm provenance, as n8n requires for verified community nodes. No functional changes.

## 0.1.0

- Klap node: Project (Create, Get, Get Many), Clip (Get Many, Export, Schedule, Write Caption), Export (Get), Social Account (Get Many).
- Klap Trigger (polling): Project Ready, New Clip, Project Failed.
- Klap OAuth2 credential: sign in with your Klap account, no client ID or secret (OAuth dynamic client registration).
