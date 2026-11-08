# Shotlane

[Shotlane](https://shotlane.dev) gives agents a real browser. Screenshots, phone, tablet and desktop checks, pages as
Markdown and HTML to PDF, as an MCP server and an Agent Skill.

100 free renders a month, no card. Paid credits never expire. [Get an API key](https://shotlane.dev/signup) ·
[Docs](https://shotlane.dev/docs) · [Pricing](https://shotlane.dev/pricing)

## MCP server

```bash
claude mcp add --transport http shotlane https://shotlane.dev/mcp
```

ChatGPT, Claude, Cursor and VS Code sign in with OAuth, so the URL is all you need. Other clients can use
`https://shotlane.dev/mcp?key=<your API key>`, and the [Hermes](hermes) package sends `SHOTLANE_API_KEY`. Setup for each client: [MCP docs](https://shotlane.dev/docs/mcp).

| Tool | |
|---|---|
| `screenshot` | A page as an image: viewport, full page or one element. |
| `check_page` | Screenshots on phone, tablet and desktop, plus the problems a person would notice. |
| `read_page` | The page's main content as Markdown. |
| `html_to_pdf` | HTML or a URL as a PDF. |
| `credits` | Credits left. |

Try: "Use Shotlane to check whether example.com looks right on phone, tablet and desktop."

## Agent Skill

```bash
npx skills add shotlane/shotlane
```

[skills/shotlane](skills/shotlane) tells an agent when and how to call Shotlane, with a one-file Python script. No MCP needed.

## Without a key

```bash
curl https://shotlane.dev/md/https://react.dev/learn
```

5 requests a day. The full API is in the [docs](https://shotlane.dev/docs).

## What leaves your machine

Every tool call sends its URL or HTML to shotlane.dev, with your API key or OAuth token. MCP results stay at unguessable
links for 24 hours, then they're deleted. Nothing else: no telemetry, no background processes. [Privacy](https://shotlane.dev/privacy)

## License

MIT for this repository. The service has its own [terms](https://shotlane.dev/terms).
