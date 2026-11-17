# Prod stack (plan §1, §9 Phase 3), us-east-1. State lives in the bucket from ../bootstrap with
# S3's native lockfile (no DynamoDB table).
#
#   ../scripts/build-lambda.sh          # → ../build/lambda.zip (all three functions)
#   terraform init -backend-config=backend.hcl && terraform plan -out tfplan && terraform apply tfplan
#
# The zip only matters when a function is created. After that the code ships from GitHub Actions on
# a merge to main (.github/workflows/ci.yml, github.tf) and Terraform ignores it.
#
# The account ID and owner email live in terraform.tfvars, the state bucket in backend.hcl. Both
# are gitignored; copy them from the .example files.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.71" }
  }
  backend "s3" {
    # bucket comes from backend.hcl (terraform init -backend-config=backend.hcl)
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
  account_id = var.aws_account_id
  region     = "us-east-1"
  name       = "jobtracker"
  ssm_prefix = "/jobtracker/prod/"
  # Secret names in SSM (SecureString, aws/ssm key). Terraform never creates or reads them, so
  # their values can't end up in state: `jobtracker aws push-secrets` writes them from .env.
  # The Anthropic API isn't among them: the Lambdas use Workload Identity Federation (below).
  secrets = {
    api    = ["GOOGLE_SERVICE_ACCOUNT_KEY"]
    ingest = ["GMAIL_APP_PASSWORD", "GOOGLE_SERVICE_ACCOUNT_KEY"]
    # The digest goes out through Gmail's SMTP with the app password.
    discover = ["GMAIL_APP_PASSWORD"]
  }
  # Claude Console → Workload identity: rule `jobtracker-lambdas` lets the three Lambda roles
  # trade an STS web identity token for a short-lived Anthropic token acting as the service
  # account `jobtracker-prod`. IDs only, nothing secret.
  anthropic_federation = {
    ANTHROPIC_FEDERATION_RULE_ID = "fdrl_01FtW6GSychbk9hfsMSBoeHL"
    ANTHROPIC_ORGANIZATION_ID    = "80899ae9-fd8d-4294-b323-51d25aa4f7a6"
    ANTHROPIC_SERVICE_ACCOUNT_ID = "svac_015wxLrZfLgvd92drPHw4Kuc"
    ANTHROPIC_WORKSPACE_ID       = "wrkspc_01G5WFjFTUo2i3NTySkvw5wT"
  }
  dsql_endpoint = "${aws_dsql_cluster.main.identifier}.dsql.${local.region}.on.aws"
}
