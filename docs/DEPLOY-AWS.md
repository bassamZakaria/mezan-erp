# Deploying the cloud edition on AWS

The AWS footprint — Fargate task, EFS, CloudFront, API Gateway, Route 53 —
now lives in a separate private repo, `bassamZakaria/cyag-devops`, under
`apps/mezan`. See that repo's README for bootstrap, first apply, nameserver
delegation, backups and teardown. This repo only builds the app and hands the
result off.

## What this workflow does

`.github/workflows/deploy-aws.yml` runs on every push to `main`, or on
`workflow_dispatch`:

1. Assumes an AWS role over OIDC and logs in to ECR.
2. Builds the `linux/arm64` image and pushes it to ECR, tagged with the
   commit SHA.
3. Builds the web client and syncs `apps/web/dist` to the web bucket, then
   invalidates the CloudFront distribution.
4. Fires a `repository_dispatch` at `cyag-devops` (event type `mezan-deploy`,
   with the image tag and `environment: demo`), which runs `mezan-deploy.yml`
   there to apply the Terraform in `apps/mezan` against the new image.

Steps 2 and 3 talk directly to the AWS resources cyag-devops already stood
up; step 4 is the only coupling between the two repos, and it is one HTTP
call.

A deploy is a gap, not an overlap: the ECS service runs at minimum 0 percent
and maximum 100 percent healthy, so the old task stops before the new one
starts. Every tenant database is a single SQLite file opened in exclusive
locking mode, and a second task would be a second writer.

## Repository secrets

| Secret | What it is |
|---|---|
| `AWS_APP_CI_ROLE_ARN` | The OIDC role this workflow assumes to push to ECR, sync S3 and invalidate CloudFront. Created in cyag-devops. |
| `DEVOPS_DISPATCH_TOKEN` | A fine-grained personal access token scoped to `cyag-devops` with `Contents: read and write` — that is what triggering a `repository_dispatch` requires. |

## Repository variables

| Variable | What it is |
|---|---|
| `ECR_REPOSITORY_URL` | `terraform output` of `apps/mezan` in cyag-devops. |
| `WEB_BUCKET` | `terraform output` of `apps/mezan` in cyag-devops. |
| `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output` of `apps/mezan` in cyag-devops. |

Re-read these from `terraform output` in cyag-devops after any apply that
recreates the ECR repository, the web bucket or the distribution, and update
the repository variables here to match.

## Redeploying by hand

```sh
REPO=<ECR_REPOSITORY_URL>
aws ecr get-login-password --region eu-central-1 \
  | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 -t "$REPO:$(git rev-parse HEAD)" --push .

pnpm --filter web build
aws s3 sync apps/web/dist "s3://<WEB_BUCKET>" --delete
aws cloudfront create-invalidation \
  --distribution-id "<CLOUDFRONT_DISTRIBUTION_ID>" --paths "/*"
```

Then dispatch the infrastructure apply yourself, or push to `main` and let
the workflow do it.

The store reviewers' environment is a second stack of the same root; see
`docs/DEPLOY-REVIEW.md`.

## Owner must do before deploy

**This build does not start on the task definition `cyag-devops` applies
today.** `apps/mezan/compute.tf` sets `MEZAN_TRUST_PROXY=1` and no
`MEZAN_TRUSTED_PROXY_HOPS` (read 2026-10-13). The server now refuses that pair
at start-up (`apps/server/src/env.ts`, `parseClientSource`): with a trusted
proxy and no hop count it cannot tell the caller's address from a proxy's, and
every sign-in throttle and session binding rests on that address. The service
runs with `deployment_minimum_healthy_percent = 0`, so a task that fails to
start is not a failed deploy held behind the old task — it is an outage, on the
demo stack and on the review stack.

Before the image built from this commit is dispatched, add to
`container_environment` in `cyag-devops/apps/mezan/compute.tf`, for **both**
stacks, and apply:

```hcl
{ name = "MEZAN_TRUSTED_PROXY_HOPS", value = "2" },
{ name = "MEZAN_PUBLIC_URL", value = "https://${local.app_domain}" },
```

- `MEZAN_TRUSTED_PROXY_HOPS=2`: CloudFront appends the viewer's address and API
  Gateway appends CloudFront's. `1` would count every client as the CloudFront
  edge it came through; `3` would read an entry the caller wrote.
- `MEZAN_PUBLIC_URL`: the `https://` origin of that stack (use whatever local
  names its public hostname; `local.app_domain` above is a placeholder for it).
  Without it a mailed unlock link falls back to the tenant's subdomain, and with
  neither configured the mail carries the one-time code only.

Order: apply the Terraform change first (the running task ignores variables it
does not read), then deploy the image. Afterwards read the `origin` on a fresh
`PLATFORM_LOGIN_FAILED` audit event and compare it with your own public
address, as `docs/ENVIRONMENTS.md` describes under "Behind a proxy: which
address a request is counted against".

## Server environment variables

The app side of the contract `cyag-devops/apps/mezan/compute.tf` has to honour,
kept with the code that reads it (`apps/server/src/env.ts`). The table is
parsed by `apps/server/src/env-docs.test.ts`: a value in backticks is the
literal the stack sets, anything else is supplied from SSM or Terraform and the
test substitutes a sample of the right shape.

<!-- env-table: aws -->

| Variable | Value on both stacks | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `8080` | |
| `MEZAN_PLATFORM_DIR` | `/data` | the EFS mount |
| `MEZAN_SQLITE_EXCLUSIVE` | `1` | one writer per tenant file |
| `MEZAN_TENANT_DOMAIN` | the stack's tenant domain | |
| `MEZAN_TRUST_PROXY` | `1` | behind CloudFront and API Gateway |
| `MEZAN_TRUSTED_PROXY_HOPS` | `2` | **required with the line above — see "Owner must do before deploy"** |
| `MEZAN_PUBLIC_URL` | the stack's public `https://` origin | every mailed link is built on it; see "Owner must do before deploy" |
| `MEZAN_ORIGIN_SECRET` | SSM, generated | CloudFront adds it; a direct hit on API Gateway gets 403 on `/api/*` |
| `MEZAN_PLATFORM_OWNER_EMAIL` | SSM | the platform console owner |
| `MEZAN_PLATFORM_OWNER_PASSWORD` | SSM | |

<!-- /env-table -->
