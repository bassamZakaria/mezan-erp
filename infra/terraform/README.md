# `infra/terraform`

Two roots. `bootstrap/` is applied once by hand and creates the S3 bucket and
DynamoDB table that hold the state of everything else. The root beside it
creates the cloud edition: the web bundle on S3 behind CloudFront, one Fargate
task on an EFS data directory with a backup sidecar, an HTTP API in front of
it, and the Route 53 zone that serves the domain and every tenant subdomain.

Region is `eu-central-1`. The CloudFront certificate is issued in `us-east-1`
through the `aws.us_east_1` provider alias, because CloudFront reads viewer
certificates only from that region.

## One-time bootstrap

```sh
cd infra/terraform/bootstrap
terraform init
terraform apply -var 'state_bucket=mezan-tfstate-<something-unique>'
```

Keep the three outputs — `state_bucket`, `lock_table`, `region`.

## Initialising the main root

```sh
cd infra/terraform
terraform init \
  -backend-config="bucket=mezan-tfstate-<something-unique>" \
  -backend-config="key=mezan/demo.tfstate" \
  -backend-config="region=eu-central-1" \
  -backend-config="dynamodb_table=mezan-tfstate-lock"
```

`envs/demo.tfvars` also carries `github_repository`, `state_bucket` and
`state_lock_table`: the deploy role trusts `repo:<github_repository>:ref:refs/heads/main`
and is granted the state bucket and lock table by name.

## Secrets

`platform_owner_password` is required and is never written to a tfvars file:

```sh
export TF_VAR_platform_owner_password='…'
```

It seeds the platform owner on the first start of the server and is then
ignored on every later apply, so changing the password in the console sticks.

`origin_secret` needs no variable: `secrets.tf` generates it with
`random_password` and stores it in SSM, `compute.tf` injects it into the app
container as `MEZAN_ORIGIN_SECRET`, and `cdn.tf` sends it on every CloudFront
request to the API origin as `x-mezan-origin`. A request that reaches the API
Gateway endpoint directly — bypassing CloudFront — carries no such header and
gets a 403.

## Applying

```sh
terraform plan  -var-file=envs/demo.tfvars -var 'image_tag=<sha>'
terraform apply -var-file=envs/demo.tfvars -var 'image_tag=<sha>'
```

`envs/demo.tfvars` ships with `domain = "example.invalid"`. Replace it with the
domain you actually own before the first apply — the ACM certificate cannot be
validated otherwise and the apply will sit waiting.

## Nameservers

The first apply creates the hosted zone. Enter

```sh
terraform output hosted_zone_name_servers
```

at the registrar for the domain. Until the delegation is live, ACM cannot
validate the certificate and CloudFront cannot finish.

## Deploy loop

`.github/workflows/deploy-aws.yml` runs it on every push to `main`, in this
order: `terraform init`, a targeted apply of the ECR repository alone (the full
apply names an image tag that does not exist yet, so the registry has to come
first), build and push the ARM64 image under the commit SHA, the full
`terraform apply` with that tag, sync `apps/web/dist` into the web bucket,
invalidate the distribution.

It signs in with the role `github-oidc.tf` creates, assumed through GitHub's
OIDC provider — no long-lived keys. Put

```sh
terraform output -raw deploy_role_arn
```

in the `AWS_DEPLOY_ROLE_ARN` repository secret.

### Narrowing the deploy role

`deploy_role_admin` defaults to `true`, which attaches `AdministratorAccess`:
`terraform apply` creates VPCs, IAM roles, CloudFront distributions and ACM
certificates, and a hand-written policy for that drifts every time the
footprint changes. Once it stops changing, set `deploy_role_admin = false` and
replace it with the services the apply actually touches — run the apply once
with CloudTrail on and read the calls off it. The inline policy in the same
file (ECR push, ECS update, the web bucket, CloudFront invalidation, the state
bucket and lock table) is what the workflow's own steps need and stays either
way.

## Price class

`PriceClass_100` is Europe, Israel and North America only. Egypt is served out
of the European edges, which is one extra hop and a few tens of milliseconds;
`PriceClass_All` adds the Middle East edges and roughly doubles the delivery
price for a demo that does not need them.

## Cost

| Item | Monthly |
|---|---|
| Fargate, 0.25 vCPU / 0.5 GB, always on | ≈ 9 USD |
| API Gateway HTTP API | < 1 USD |
| Route 53 hosted zone | 0.50 USD |
| EFS, S3, ECR, CloudWatch logs | cents |
| CloudFront, ACM | free tier |
| **Total** | **≈ 11–13 USD** |
