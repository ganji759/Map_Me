# Security Policy

## Supported versions

Hodari ships from `main`. Security fixes go to `main` only. There is no
long-term support branch.

## Report a vulnerability

**Do not open a public issue.**

Report a vulnerability in one of these two ways:

1. **GitHub private reporting (preferred).** Go to the **Security** tab of this
   repository and choose **Report a vulnerability**. This opens a private
   advisory that only the maintainers can read.
2. **Email.** Send the report to `pacymugisho@gmail.com` with the subject
   `SECURITY: <short summary>`.

Please include:

- The affected component, such as the agent runtime, the Next.js client, or an
  MCP sidecar.
- The steps that reproduce the problem.
- What an attacker gains.
- Your suggested fix, if you have one.

## What happens next

| Step | Target time |
|---|---|
| We confirm we received your report | 3 working days |
| We give you our first assessment | 10 working days |
| We release a fix for a confirmed high severity problem | 30 days |

We credit you in the advisory unless you ask us not to.

## Scope

**In scope**

- The agent runtime in `agents/`.
- The Next.js client in `client/`, including the API route handlers.
- The MCP sidecars in `agents/community_mcp/` and `infra/mongodb-mcp/`.
- The Cloud Run service templates in `infra/`.
- Prompt injection that makes an agent leak another user's data or call a tool
  it must not call.

**Out of scope**

- Vulnerabilities in Google Maps Platform, Vertex AI, MongoDB Atlas, or Stripe.
  Report those to the vendor.
- Denial of service through plain request volume.
- Missing security headers with no shown impact.
- Results from an automatic scanner with no proof of exploitation.

## For people who deploy Hodari

Hodari holds real user data and calls paid APIs. If you run your own instance:

- Keep every secret in a secret manager. The templates in `infra/` use Google
  Secret Manager references, not plain values.
- Rotate your Google Maps key, your Gemini key, and your MongoDB password if you
  ever commit them, even for one push.
- Restrict your Google Maps browser key by HTTP referrer and your server key by
  IP address.
- Do not expose the agent service to the public internet. Give the frontend
  service account the `run.invoker` role and remove `allUsers`.
- Read [docs/SECURITY_HARDENING.md](./docs/SECURITY_HARDENING.md) for the full
  checklist.
