# One Lambda function (arm64, Python 3.12, zip) with its own execution role and a log group
# that keeps 14 days. The role trusts Lambda only for this function in this account.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" { type = string }
variable "description" { type = string }
variable "handler" { type = string }
variable "zip_path" { type = string }
variable "memory_mb" { type = number }
variable "timeout_s" { type = number }
variable "environment" { type = map(string) }
variable "policy_json" {
  type        = string
  description = "Inline policy with what the code calls (DSQL, SSM, …), on top of its own logs."
}
variable "reserved_concurrency" {
  type    = number
  default = -1 # -1 = unreserved
}
variable "log_retention_days" {
  type    = number
  default = 14
}

data "aws_caller_identity" "me" {}
data "aws_region" "here" {}
data "aws_partition" "here" {}

locals {
  account_id   = data.aws_caller_identity.me.account_id
  region       = data.aws_region.here.region
  function_arn = "arn:${data.aws_partition.here.partition}:lambda:${local.region}:${local.account_id}:function:${var.name}"
  log_group    = "/aws/lambda/${var.name}"
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.function_arn]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.name}-lambda"
  description        = "Execution role for ${var.name}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

resource "aws_cloudwatch_log_group" "this" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "logs" {
  statement {
    sid       = "OwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  name   = "logs"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.logs.json
}

resource "aws_iam_role_policy" "app" {
  name   = "app"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

resource "aws_lambda_function" "this" {
  function_name                  = var.name
  description                    = var.description
  role                           = aws_iam_role.this.arn
  runtime                        = "python3.12"
  architectures                  = ["arm64"]
  handler                        = var.handler
  filename                       = var.zip_path
  source_code_hash               = filebase64sha256(var.zip_path)
  memory_size                    = var.memory_mb
  timeout                        = var.timeout_s
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = var.environment
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.this.name
  }

  # The log group (with its retention) and the permissions exist before the first invocation,
  # so Lambda never creates a never-expiring group of its own.
  depends_on = [aws_iam_role_policy.logs, aws_iam_role_policy.app]
}

output "function_name" { value = aws_lambda_function.this.function_name }
output "function_arn" { value = aws_lambda_function.this.arn }
output "role_arn" { value = aws_iam_role.this.arn }
output "role_name" { value = aws_iam_role.this.name }
