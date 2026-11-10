# shotlane

Screenshots, PDFs, Markdown and phone/tablet/desktop checks of any web page, rendered in a real Chromium by
[Shotlane](https://shotlane.dev). A command and a Node client for Node 18+, Deno and Bun. No dependencies.

## Command

```bash
npx shotlane md https://react.dev/learn          # the page as Markdown, no key needed
npx shotlane login                               # save your API key
npx shotlane shot example.com --full-page        # example.com.png
npx shotlane pdf invoice.html                    # invoice.pdf
npx shotlane check example.com                   # problems on phone, tablet and desktop
npx shotlane credits
```

Any API option works as a flag: `--device iphone`, `--format webp`, `--dark-mode`, `--devices iphone,desktop`.
`-o` sets the file, `-o -` prints it. `check` exits 1 when it finds problems, so it works in CI.
`shotlane --help` lists everything.

## Client

```js
import { Shotlane } from "shotlane";
const s = new Shotlane(process.env.SHOTLANE_API_KEY);
const png = await s.screenshot("https://example.com", { full_page: true });
```

Without npm: `curl -O https://shotlane.dev/sdk/shotlane.mjs`. Docs: https://shotlane.dev/docs/sdks

100 free credits a month, no card: [get a key](https://shotlane.dev/signup).
