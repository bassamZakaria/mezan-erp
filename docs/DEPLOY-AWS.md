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

## Server environment

The task's environment is set in `cyag-devops/apps/mezan/compute.tf`, for the
demo stack and the reviewer stack alike; this repository lists the reviewer
stack's in `docs/DEPLOY-REVIEW.md`. Two variables the server refuses to start
without, on either stack:

- `MEZAN_TRUSTED_PROXY_HOPS=2` beside `MEZAN_TRUST_PROXY=1` (CloudFront, then
  API Gateway).
- `MEZAN_PUBLIC_URL=https://<the stack's domain>` once `MEZAN_SMTP_HOST` is set.

Every variable is described in `docs/ENVIRONMENTS.md`.

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
