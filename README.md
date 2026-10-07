# n8n-nodes-klap

This is an n8n community node. It lets you use [Klap](https://klap.app) in your n8n workflows.

Klap is an AI video editor that turns long videos into viral short clips with captions and reframing for TikTok, Reels and YouTube Shorts. With this node you can clip videos, get the clips Klap found, render them to MP4, write captions and schedule posts, all from a workflow.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Example workflows](#example-workflows)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-klap`.

## Operations

A **project** is one long video you clipped; its **clips** are the short videos Klap made from it.

### Klap node

| Resource | Operation | What it does |
|---|---|---|
| Project | Create | Clip a video: from a link (YouTube, Google Drive, Dropbox, Vimeo, Twitch, Loom or a direct link to a video file) or from a binary file (MP4, MOV or WebM, uploaded for you). Options: max number of clips, clip length, aspect ratio, language, instructions ("the funniest moments"), project name. Returns the project right away with status `processing`; clipping takes several minutes. |
| Project | Get | A project and, once it is ready, its clips (best first). |
| Project | Get Many | Your most recent projects, newest first (up to 50). |
| Clip | Get Many | The clips of a ready project, best first, with an optional minimum virality score. |
| Clip | Export | Renders a clip to MP4 and waits until it is ready (10 minutes by default; you can turn waiting off). Can add the MP4 to the output as binary data. |
| Clip | Schedule | Posts a clip to one or more connected social accounts (YouTube, TikTok, Instagram, Facebook, LinkedIn), now or at a set time. Leave the caption empty and Klap writes one. Outputs one item per post. |
| Clip | Write Caption | Writes a social media caption for a clip with AI, in the tone you choose. |
| Export | Get | Status and video URL of an export started earlier. |
| Social Account | Get Many | The social accounts connected to your Klap account. |

Projects, clips and social accounts can be picked from a list or set by ID (clips also by their `https://klap.app/editor/…` URL).

### Klap Trigger node (polling)

| Event | Fires |
|---|---|
| Project Ready | Once per project when it finishes, with all its clips (best first). |
| New Clip | Once per clip of newly ready projects. Options: *Minimum Virality Score* and *Only the Best N Clips per Project*. Looks at your 10 most recent ready projects. |
| Project Failed | Once per project Klap couldn't clip, with the reason in `error_message`. |

When you activate a workflow, the trigger only remembers what already exists: it never fires for past projects. When you test it in the editor, it returns your most recent real item.

### Output fields

Every operation returns the same field names as Klap's Zapier and Make apps:

- **Project**: `id`, `name`, `status` (`processing`, `ready`, `error` or `expired`), `error_code`, `error_message`, `source_url`, `thumbnail_url`, `created_at`, `estimated_ready_at`, `url`, and when fetched `clip_count` and `clips`.
- **Clip**: `id`, `name`, `virality_score` (0–100), `virality_score_explanation`, `duration_seconds`, `width`, `height`, `thumbnail_url`, `preview_url`, `editor_url`, `created_at`, `rank` (1 = best of its project), `project_id`, `project_name`, `project_url`.
- **Export**: `id`, `clip_id`, `status`, `video_url` (a public MP4 link once ready), `file_name`, `estimated_ready_at`, `created_at`, `finished_at`.
- **Scheduled post**: `id`, `clip_id`, `account_id`, `provider`, `account_name`, `scheduled_at`, `status`, `calendar_url`.

## Credentials

You connect with your Klap account. There is no API key, client ID or client secret to copy.

1. Sign up at [klap.app](https://klap.app) if you don't have an account.
2. In n8n, create a **Klap OAuth2 API** credential and click **Connect my account**.
3. Sign in to Klap and allow access for n8n.

What you do with the node counts toward your Klap plan, as on klap.app: clipping uses your video allowance, exports your export allowance, and scheduling needs a plan that includes it. See [klap.app/pricing](https://klap.app/pricing).

How it works: Klap uses OAuth 2.1 with PKCE. n8n registers itself with Klap's authorization server automatically (OAuth dynamic client registration) the first time you connect, so the same credential works on n8n Cloud and on any self-hosted instance. n8n refreshes the access token on its own; if it ever can't, the node says "Your Klap connection expired. Reconnect your Klap account." Open the credential and click **Reconnect**.

Self-hosted: n8n sends Klap its OAuth callback URL (`<your n8n URL>/rest/oauth2-credential/callback`). Make sure your instance's public URL is set (`N8N_EDITOR_BASE_URL` or `WEBHOOK_URL`) so that URL is right.

## Compatibility

- Requires n8n **2.12.0 or later**: the credential relies on n8n's OAuth dynamic client registration with protected resource (RFC 9728) and path-aware authorization server (RFC 8414) discovery, added in n8n 2.12.0. From n8n 2.28.0, n8n requests exactly the scopes Klap's API advertises (`openid email profile`); 2.12 to 2.27 request every scope Klap's authorization server lists.
- Built and type-checked against `n8n-workflow` 2.42. No runtime dependencies.
- Works on n8n Cloud. Long exports wait inside the execution, so on plans with a short execution time limit, turn off **Wait for Export** and use **Export → Get** later, or the Klap Trigger.

## Usage

- **Clipping takes several minutes.** Project → Create returns at once. To act on the clips, start a second workflow with the Klap Trigger (Project Ready or New Clip), or use Project → Get later.
- **Exports**: Clip → Export renders the clip (about as long as the clip itself) and waits for it. `video_url` is a public link you can pass to other nodes; turn on **Download Video** to get the MP4 as binary data (for Google Drive, Dropbox, S3 and so on). Exports count toward your plan's export allowance, so export a clip once and reuse its `video_url`.
- **Scheduling**: connect your social accounts in Klap first, at [klap.app/calendar](https://klap.app/calendar). Leave **Publish At** empty to post within a couple of minutes. Times without an offset are read in the **Time Zone** you set (UTC by default); values with an offset, such as `{{ $now.plus(1, 'day') }}`, are used as they are. A clip can go to one account per platform at a time. Posting to TikTok needs **TikTok Privacy** (under Additional Fields). Review or change posts at [klap.app/calendar](https://klap.app/calendar).
- **Errors** tell you what to do: for example "This isn't included in your current Klap plan (available on the Pro plan). See plans at https://klap.app/pricing." or "This YouTube video is age-restricted." Turn on **Continue On Fail** to keep going and get the message in an `error` field.
- New to n8n? See [Try it out](https://docs.n8n.io/try-it-out/).

## Example workflows

**1. Post the best clip of every new project to YouTube Shorts.** Klap Trigger (New Clip, *Only the Best N Clips per Project* = 1, *Minimum Virality Score* = 70) → Klap (Clip → Schedule, Clip ID `{{ $json.id }}`, your YouTube account, caption left empty so Klap writes one).

Copy this JSON and paste it into an n8n workflow, then pick your Klap credential and social account:

```json
{
  "name": "Klap: post the best clip of each new project",
  "nodes": [
    {
      "parameters": {
        "pollTimes": { "item": [{ "mode": "everyX", "value": 5, "unit": "minutes" }] },
        "event": "newClip",
        "options": { "minViralityScore": 70, "clipsPerProject": 1 }
      },
      "name": "Klap Trigger",
      "type": "n8n-nodes-klap.klapTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "clip",
        "operation": "schedule",
        "clipId": { "__rl": true, "mode": "id", "value": "={{ $json.id }}" },
        "accountIds": [],
        "additionalFields": {}
      },
      "name": "Schedule the clip",
      "type": "n8n-nodes-klap.klap",
      "typeVersion": 1,
      "position": [260, 0]
    }
  ],
  "connections": {
    "Klap Trigger": { "main": [[{ "node": "Schedule the clip", "type": "main", "index": 0 }]] }
  }
}
```

**2. Clip every video added to a Google Drive folder.** Google Drive Trigger (File Created in a folder) → Google Drive (Download) → Klap (Project → Create, Video Source *Binary File*, Input Binary Field `data`). Or skip the download and pass the file's share link as *Video URL*.

**3. Back up every good clip to Dropbox.** Klap Trigger (New Clip, *Minimum Virality Score* = 80) → Klap (Clip → Export, Clip ID `{{ $json.id }}`, *Download Video* on) → Dropbox (Upload, binary field `data`, file name `{{ $json.file_name }}`).

**4. Clip each new YouTube upload.** RSS Feed Trigger (`https://www.youtube.com/feeds/videos.xml?channel_id=<your channel id>`) → Klap (Project → Create, Video URL `{{ $json.link }}`, Instructions "the most quotable moments").

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Klap](https://klap.app) · [Pricing](https://klap.app/pricing) · [Privacy policy](https://klap.app/privacy-policy) · [Terms](https://klap.app/terms-of-services)
- Support: [support@klap.app](mailto:support@klap.app)

## Version history

- **0.1.0**: first release. Klap node (Project, Clip, Export, Social Account), Klap Trigger (Project Ready, New Clip, Project Failed) and the Klap OAuth2 API credential.
