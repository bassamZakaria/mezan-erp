terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.64"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = local.region

  default_tags {
    tags = {
      Project     = "mezan"
      Environment = var.environment
    }
  }
}

# CloudFront only reads viewer certificates out of us-east-1, so the ACM
# certificate for the distribution must be issued by this aliased provider.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "mezan"
      Environment = var.environment
    }
  }
}
