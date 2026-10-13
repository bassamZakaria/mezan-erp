# The store reviewers' environment

Apple and Google reviewers sign in to the Mezan phone app with credentials we
give them, against a server that must answer every time they try. The public
demo cannot be that server: `demo.mezan.app` answers **530**, and
`mezan-demo.onrender.com` sits behind HTTP basic auth the app does not send,
keeps its data in `/tmp/platform`, and sleeps on the free tier (on 2026-09-21 it
did not answer at all within 90 seconds, over IPv4 or IPv6).

The reviewer environment is a second stack of the AWS cloud edition, defined
in `bassamZakaria/cyag-devops` (`apps/mezan/envs/review.tfvars`, branch
`feat/mezan-review-env`). **Nothing here is deployed.** Applying it needs the
owner's AWS account, a domain and a support mailbox.

## What makes it different from the demo

| | Render demo | Reviewer environment |
|---|---|---|
| Basic auth | Required (`MEZAN_SEED_DEMO=1` forces it) | None — the app would be refused |
| Data | `/tmp/platform`, wiped on restart | EFS, encrypted, backed up to S3 |
| Cold start | Sleeps when idle | One Fargate task, always on |
| Tenant | `demo`, every persona on the published PIN `123456` | `review`, every account on a PIN generated per deploy |
| Legal pages | `/legal/*` served above the basic auth | `/legal/*`, routed by CloudFront to the server |

The server seeds the reviewer tenant once, on its first start, with the same
demo data (`packages/backend/src/demo-seed.ts`), then moves every account onto
`MEZAN_REVIEW_PIN` through the tenant's own `PUT /users/:id`
(`apps/server/src/review-tenant.ts`). Later starts find the tenant and leave
the reviewers' own writes alone.

## Server environment variables

Set by `cyag-devops/apps/mezan/compute.tf`; listed here so the app side of the
contract lives with the code that reads it (`apps/server/src/env.ts`).

<!-- env-table: review -->

| Variable | Value on the reviewer stack | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `8080` | |
| `MEZAN_PLATFORM_DIR` | `/data` | the EFS mount |
| `MEZAN_SQLITE_EXCLUSIVE` | `1` | one writer per tenant file |
| `MEZAN_TENANT_DOMAIN` | the review domain | |
| `MEZAN_TRUST_PROXY` | `1` | behind CloudFront and API Gateway |
| `MEZAN_TRUSTED_PROXY_HOPS` | `2` | CloudFront appends the viewer's address, API Gateway appends CloudFront's. Required: the server refuses to start with `MEZAN_TRUST_PROXY=1` and no count. Set to `1`, every client would be counted as the CloudFront edge it came through; the server logs `CLIENT ADDRESS MISMATCH` when the count disagrees with `CloudFront-Viewer-Address` — see [ENVIRONMENTS.md](ENVIRONMENTS.md) |
| `MEZAN_PUBLIC_URL` | the review stack's public `https://` origin | Every mailed link is built on it (signup verification, owner hand-over, the unlock link of a locked account). Not set by `compute.tf` today: see "Owner must do before deploy" in [DEPLOY-AWS.md](DEPLOY-AWS.md). |
| `MEZAN_ORIGIN_SECRET` | SSM, generated | CloudFront adds it; a direct hit on API Gateway gets 403 on `/api/*` |
| `MEZAN_PLATFORM_OWNER_EMAIL` | SSM | the platform console owner |
| `MEZAN_PLATFORM_OWNER_PASSWORD` | SSM | |
| `MEZAN_REVIEW_TENANT_CODE` | `review` | 2–40 of `a-z0-9-`, never `demo` |
| `MEZAN_REVIEW_PIN` | SSM `/mezan/review/review-pin`, generated | six digits; the server refuses `123456` |
| `MEZAN_SUPPORT_EMAIL` | the owner's support mailbox | required with a reviewer tenant; printed on both legal pages |
| `MEZAN_SMTP_HOST` | optional | platform mail; see below |
| `MEZAN_SMTP_FROM_EMAIL` | optional; required with `MEZAN_SMTP_HOST` | the sender address |

<!-- /env-table -->

`MEZAN_SMTP_HOST` … `MEZAN_SMTP_FROM_EMAIL` are optional: only with them does
the deletion page show a form (without them it shows the support address), and
only with them is a locked account mailed its unlock code and link. Without
mail on a cloud stack a locked sole administrator is unlocked from the platform
console (tenant page, «حسابات مقفلة عن الدخول»).

`MEZAN_TRUSTED_PROXY_HOPS` is **not set by `cyag-devops/apps/mezan/compute.tf`
today** and this build refuses to start without it: see "Owner must do before
deploy" in [DEPLOY-AWS.md](DEPLOY-AWS.md).

### The viewer-address check needs a header CloudFront does not send by default

The `CLIENT ADDRESS MISMATCH` line compares the counted hop with
`CloudFront-Viewer-Address`. CloudFront adds that header only when the cache
behaviour's origin request policy names it
(<https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html>).
`cyag-devops/modules/static-site/cdn.tf` uses the managed
`Managed-AllViewerExceptHostHeader` policy, which forwards the viewer's own
headers and no CloudFront header, so on this stack the header never arrives:
the check stays silent however wrong the hop count is, and
`MEZAN_TRUST_VIEWER_ADDRESS=1` would fall back to the hop count on every
request. Until the origin request policy for `/api/*` and `/legal/*` forwards
`CloudFront-Viewer-Address`, a wrong `MEZAN_TRUSTED_PROXY_HOPS` is found only by
reading an audit event's address by hand.

Once that policy forwards the header, `MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER=cloudfront-viewer-address`
reads the caller from it directly and refuses a request that arrives without
it; like `MEZAN_TRUST_VIEWER_ADDRESS`, it is only CloudFront's word while
`MEZAN_ORIGIN_SECRET` keeps everything else from reaching the origin. It is
not set on this stack today, for the reason above: the header never arrives,
so every request would be refused.

One policy cannot both drop the viewer's `Host` and add a CloudFront header
(<https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/origin-request-understand-origin-request-policy.html>),
so the change replaces the managed policy with one that lists the headers the
API reads. It belongs to `cyag-devops`; the owner applies it there.

Must **not** be set: `MEZAN_SEED_DEMO` (the server refuses it next to a
reviewer tenant — its basic auth would block the app), `MEZAN_SEED_ADMIN_PIN`,
`MEZAN_PAYMOB_TEST_MODE`.

## GitHub settings in this repository

The review stack has its own ECR repository, web bucket, distribution and
app-ci role. `.github/workflows/deploy-aws.yml` reads these on a manual run with
`environment: review`, and refuses to start when one is missing rather than
fall back to the demo's:

| Kind | Name | Value |
|---|---|---|
| Secret | `AWS_REVIEW_APP_CI_ROLE_ARN` | `terraform output -raw app_ci_role_arn` of the review stack |
| Variable | `REVIEW_ECR_REPOSITORY_URL` | `terraform output -raw ecr_repository_url` |
| Variable | `REVIEW_WEB_BUCKET` | `terraform output -raw web_bucket` |
| Variable | `REVIEW_CLOUDFRONT_DISTRIBUTION_ID` | `terraform output -raw cloudfront_distribution_id` |

## Runbook — the owner, once

1. **Decide the domain** — e.g. `review.<your domain>` — and the support
   mailbox. Put both, and the state bucket, into `envs/review.tfvars` in
   cyag-devops; merge `feat/mezan-review-env`.
2. **Apply the stack** (cyag-devops README, "The store reviewers' environment").
   The first apply creates the hosted zone; delegate it from the parent zone
   with an `NS` record and re-run the apply once the certificate validates.
3. **Copy the outputs** into the secret and three variables above.
4. **Deploy the app**: Actions → Deploy AWS → Run workflow, branch
   `production`, environment `review`. This pushes the image, syncs the web
   client and dispatches `mezan-deploy` with `environment: review`.
5. **Read the PIN** for the review notes:
   `aws ssm get-parameter --name /mezan/review/review-pin --with-decryption --query Parameter.Value --output text`.
6. **Verify**, from any machine:

   ```sh
   H=https://<review domain>
   curl -sS -o /dev/null -w '%{http_code}\n' $H/healthz                          # 200
   curl -sS -o /dev/null -w '%{http_code}\n' $H/legal/privacy                    # 200
   curl -sS -o /dev/null -w '%{http_code}\n' "$H/legal/account-deletion?lang=en" # 200
   curl -sS -o /dev/null -w '%{http_code}\n' -H 'content-type: application/json' \
     -H 'x-mezan-tenant: review' -d '{"username":"admin@cyag.example","pin":"123456"}' \
     $H/api/auth/login                                                           # 401
   dig +short AAAA <review domain>                                               # at least one address
   curl -6 -sS -o /dev/null -w '%{http_code}\n' $H/healthz                       # 200
   ```

7. **Point the app at it**: the app's compiled default API host becomes
   `https://<review domain>/api` (Phase B of the store work; the readiness
   check `default-api-host` fails until it does).

## IPv6

Apple reviews on an IPv6-only network. The stack serves IPv6 end to end on the
viewer side: the distribution sets `is_ipv6_enabled = true`
(`cyag-devops/modules/static-site/cdn.tf:32`) and every alias gets an `AAAA`
record beside its `A` (`modules/dns-zone/variables.tf:15`,
`alias_record_types = ["A", "AAAA"]`). CloudFront reaches API Gateway over its
own network, so the origin needs no IPv6. The app contains no IPv4 literal
(readiness check `no-ipv4-literal`). By comparison, `mezan-demo.onrender.com`
publishes no `AAAA` record at all (checked 2026-09-21), and `demo.mezan.app`
has `AAAA` records but answers 530.

## Verified locally

`MEZAN_REVIEW_TENANT_CODE=review MEZAN_REVIEW_PIN=<six digits>
MEZAN_SUPPORT_EMAIL=<address> pnpm server` seeds the tenant and serves both
pages. On 2026-09-21: `/legal/privacy`, `?lang=en`, `/legal/account-deletion`
and `?lang=en` → 200; `admin@cyag.example` with the reviewer PIN → 200, with
`123456` → 401; `ahmed.shennawy@cyag.example` with the reviewer PIN → 200.
