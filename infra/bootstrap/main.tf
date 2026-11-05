# One-time bootstrap: the S3 bucket that holds the prod stack's Terraform state.
# Local state on purpose (it's only this bucket). Locking in prod uses S3's native lockfile
# (`use_lockfile = true`), so there is no DynamoDB table.
#
#   cd infra/bootstrap && terraform init && terraform plan -out tfplan && terraform apply tfplan

terraform {
  required_version = ">= 1.10.0" # S3 native state locking
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.71" }
  }
}

variable "aws_profile" {
  type    = string
  default = "jobtracker"
}

locals {
  account_id = "630773215521"
  region     = "us-east-1"
  bucket     = "jobtracker-tfstate-${local.account_id}"
}

provider "aws" {
  region              = local.region
  profile             = var.aws_profile
  allowed_account_ids = [local.account_id]
  default_tags {
    tags = { project = "jobtracker", managed-by = "terraform", stack = "bootstrap" }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning lets you roll a broken state back.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Old state versions cost cents but pile up; keep 90 days of history.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "state" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  policy     = data.aws_iam_policy_document.state.json
  depends_on = [aws_s3_bucket_public_access_block.state]
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}
