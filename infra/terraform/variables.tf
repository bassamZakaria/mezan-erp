variable "region" {
  description = "AWS region every resource but the CloudFront certificate is created in."
  type        = string
  default     = "eu-central-1"
}

variable "vpc_cidr" {
  description = "IPv4 range of the VPC; the two public subnets are /24s cut out of it."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.vpc_cidr, 8, 1))
    error_message = "vpc_cidr must be a CIDR block with room for at least two /24 subnets."
  }
}

variable "github_repository" {
  description = "owner/name of the GitHub repository the deploy role trusts on refs/heads/main."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/name."
  }
}

variable "state_bucket" {
  description = "Bootstrap state bucket the deploy role is allowed to read and write; the same name passed to -backend-config=bucket=."
  type        = string
}

variable "state_lock_table" {
  description = "Bootstrap lock table the deploy role is allowed to lock; the same name passed to -backend-config=dynamodb_table=."
  type        = string
  default     = "mezan-tfstate-lock"
}

variable "deploy_role_admin" {
  description = "Attaches AdministratorAccess to the deploy role so terraform apply can create anything; narrow it per the README once the footprint stops changing."
  type        = bool
  default     = true
}

variable "environment" {
  description = "Environment name; every resource is called mezan-<environment>-<resource> and tagged with it."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "environment must be lower-case letters, digits and hyphens, 2 to 21 characters."
  }
}

variable "domain" {
  description = "Apex domain the cloud edition is served on; Terraform creates its Route 53 hosted zone."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.domain))
    error_message = "domain must be a bare domain name such as mezan.example, with no scheme and no trailing dot."
  }
}

variable "image_tag" {
  description = "Tag of the application image in ECR the ECS task definition runs."
  type        = string
  default     = "latest"

  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$", var.image_tag))
    error_message = "image_tag must be a valid container image tag."
  }
}

variable "app_cpu" {
  description = "Fargate CPU units for the task."
  type        = number
  default     = 256

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.app_cpu)
    error_message = "app_cpu must be one of 256, 512, 1024, 2048, 4096."
  }
}

variable "app_memory" {
  description = "Fargate memory in MiB for the task."
  type        = number
  default     = 512

  validation {
    condition     = var.app_memory >= 512 && var.app_memory <= 30720
    error_message = "app_memory must be between 512 and 30720 MiB."
  }
}

variable "desired_count" {
  description = "Number of tasks the ECS service keeps running."
  type        = number
  default     = 1

  # Every tenant database is one SQLite file on EFS opened in exclusive locking
  # mode. A second task would be a second writer and would corrupt them.
  validation {
    condition     = var.desired_count == 0 || var.desired_count == 1
    error_message = "desired_count must be 0 or 1; the app is a single writer over the shared tenant files."
  }
}

variable "tenant_domain" {
  description = "Domain whose first label names the tenant; defaults to var.domain when null."
  type        = string
  default     = null
}

variable "platform_owner_email" {
  description = "E-mail address of the platform owner account the server seeds on first start."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.platform_owner_email))
    error_message = "platform_owner_email must be an e-mail address."
  }
}

variable "platform_owner_password" {
  description = "Initial password of the platform owner account; supply through TF_VAR_platform_owner_password, never a tfvars file."
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.platform_owner_password)) >= 12
    error_message = "platform_owner_password must be set and at least 12 characters; export TF_VAR_platform_owner_password."
  }
}

variable "backup_interval_minutes" {
  description = "Minutes the backup sidecar waits between syncs of /data/backups to the backup bucket."
  type        = number
  default     = 15

  validation {
    condition     = var.backup_interval_minutes >= 1 && var.backup_interval_minutes <= 1440
    error_message = "backup_interval_minutes must be between 1 and 1440."
  }
}

variable "log_retention_days" {
  description = "Days CloudWatch keeps the application and API access logs."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a retention period CloudWatch Logs accepts."
  }
}

variable "alarm_email" {
  description = "Address subscribed to the task-down alarm; no alarm and no topic are created when null."
  type        = string
  default     = null

  validation {
    condition     = var.alarm_email == null || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", coalesce(var.alarm_email, "")))
    error_message = "alarm_email must be an e-mail address or null."
  }
}

locals {
  region        = var.region
  name          = "mezan-${var.environment}"
  tenant_domain = coalesce(var.tenant_domain, var.domain)
  wildcard      = "*.${var.domain}"
}
