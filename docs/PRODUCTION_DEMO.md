# Public production demo

Set `DEMO_LOGIN_ENABLED=true` on the Render backend and deploy the latest `main`.
Set `CORS_ORIGIN` to the exact production Vercel domains, separated by commas.
`DEMO_ENVIRONMENT=isolated` is no longer required. Set the enable flag to `false`
to hide the demo and revoke demo sessions without affecting real members.

The welcome page links to Live Demo, and Sign In offers Alex and Elena directly.
These are the only two selectable demo logins. They are pre-matched: open one
browser/device as Alex and another as Elena to try live messaging, presence,
photo messages, and statuses. Demo media follows the existing expiry rules.

Sixteen fictional catalogue profiles are created in the demo audience on first
login. They pre-like both personas so visitors can try swiping and mutual
matching; they are not live users and do not generate chat replies. Demo users
cannot discover or swipe real members; real members cannot discover or swipe
demo profiles. Status feeds and status media respect the same separation.

All visitors choosing the same persona share its profile, swipes and activity.
Demo chat is public to other visitors and retained for at most the configured
`DEMO_RETENTION_HOURS` (24 by default) when demo login performs cleanup. Do not
use private information in the demo. This does not implement features that are
otherwise placeholders in the app, such as a full voice/video calling service.
