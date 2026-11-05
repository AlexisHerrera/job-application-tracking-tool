# Prod stack (plan §1, §9 Phase 3), us-east-1. State lives in the bucket from ../bootstrap with
# S3's native lockfile (no DynamoDB table).
#
#   ../scripts/build-lambda.sh          # → ../build/lambda.zip (both functions)
#   terraform init && terraform plan -out tfplan && terraform apply tfplan

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.71" }
  }
  backend "s3" {
    bucket       = "jobtracker-tfstate-630773215521"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    profile      = "jobtracker"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = "us-east-1"
  profile             = var.aws_profile
  allowed_account_ids = [local.account_id]
  default_tags {
    tags = { project = "jobtracker", managed-by = "terraform", stack = "prod" }
  }
}

locals {
  account_id = "630773215521"
  region     = "us-east-1"
  name       = "jobtracker"
  ssm_prefix = "/jobtracker/prod/"
  # Secret names in SSM (SecureString, aws/ssm key). Terraform never creates or reads them, so
  # their values can't end up in state: `jobtracker aws push-secrets` writes them from .env.
  secrets = {
    api    = ["ANTHROPIC_API_KEY", "GOOGLE_SERVICE_ACCOUNT_KEY"]
    ingest = ["GMAIL_APP_PASSWORD", "ANTHROPIC_API_KEY", "GOOGLE_SERVICE_ACCOUNT_KEY"]
  }
  dsql_endpoint = "${aws_dsql_cluster.main.identifier}.dsql.${local.region}.on.aws"
}
