variable "region" {
  description = "AWS region holding the state bucket and lock table; the same region the cloud edition runs in."
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Environment name this state belongs to, used as the Environment tag."
  type        = string
  default     = "demo"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "environment must be lower-case letters, digits and hyphens, 2 to 21 characters."
  }
}

variable "state_bucket" {
  description = "Globally unique S3 bucket name that holds the Terraform state of the main root."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket))
    error_message = "state_bucket must be a valid S3 bucket name."
  }
}

variable "lock_table" {
  description = "DynamoDB table name used for Terraform state locking."
  type        = string
  default     = "mezan-tfstate-lock"
}
