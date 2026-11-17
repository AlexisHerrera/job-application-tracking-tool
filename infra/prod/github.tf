# Deploys from GitHub Actions (.github/workflows/ci.yml) on a push to main, with no stored AWS
# keys: the workflow trades its OIDC token for this role's short-lived credentials.
#
# Only pushes to main of this one repository can assume the role (pull requests and other
# branches get a different `sub`). It can do what a deploy needs and nothing else: replace the
# three functions' code, write the SPA bucket, invalidate the distribution, and migrate DSQL.
# Infrastructure stays out of CI: Terraform runs from the laptop.

# One per account and URL. GitHub's certificate chain is verified by AWS itself, so no thumbprint.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${local.name}-github-deploy"
  description          = "GitHub Actions deploys from ${var.github_repo} main: Lambda code, SPA, DSQL migrations"
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid = "ReplaceLambdaCode"
    actions = [
      "lambda:GetFunction", # includes a link to download the live zip (the rollback copy)
      "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode",
    ]
    resources = [module.api.function_arn, module.ingest.function_arn, module.discover.function_arn]
  }
  statement {
    sid       = "ListSpaBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }
  statement {
    sid       = "WriteSpaFiles"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
  }
  statement {
    sid       = "InvalidateCdn"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.main.arn]
  }
  statement {
    sid       = "MigrateDatabase"
    actions   = ["dsql:DbConnectAdmin"]
    resources = [aws_dsql_cluster.main.arn]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

output "github_variables" {
  description = "Repository variables the deploy jobs read (Settings → Secrets and variables → Actions → Variables)."
  value = {
    AWS_DEPLOY_ROLE_ARN        = aws_iam_role.github_deploy.arn
    DSQL_ENDPOINT              = local.dsql_endpoint
    WEB_BUCKET                 = aws_s3_bucket.web.bucket
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.main.id
    APP_URL                    = "https://${var.domain}"
  }
}
