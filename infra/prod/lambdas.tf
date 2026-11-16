# All three functions run the same zip: `api` (FastAPI via Mangum, behind CloudFront + OAC),
# `ingest` (IMAP + LLM pipeline + calendar sync, every 15 minutes and from the scan button) and
# `discover` (job discovery every 6 hours and from the Discover page, plus the daily digest).

locals {
  common_env = {
    APP_ENV              = "prod"
    DSQL_ENDPOINT        = local.dsql_endpoint
    TIMEZONE             = "America/Buenos_Aires"
    ALLOWED_EMAIL        = var.owner_email
    GMAIL_ADDRESS        = var.owner_email
    GOOGLE_CALENDAR_ID   = var.owner_email # prod reads the calendar through the service account only
    SSM_PARAMETER_PREFIX = local.ssm_prefix
  }
  api_name      = "${local.name}-api"
  ingest_name   = "${local.name}-ingest"
  discover_name = "${local.name}-discover"
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "ConnectToDsqlAsAppRole"
    actions   = ["dsql:DbConnect"]
    resources = [aws_dsql_cluster.main.arn]
  }
  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameters"]
    resources = [for n in local.secrets.api : "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}${n}"]
  }
  statement {
    sid       = "RunIngestFromScanButton"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${local.region}:${local.account_id}:function:${local.ingest_name}"]
  }
  statement {
    sid       = "RunDiscoveryFromThePage"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${local.region}:${local.account_id}:function:${local.discover_name}"]
  }
}

data "aws_iam_policy_document" "ingest" {
  statement {
    sid       = "ConnectToDsqlAsAppRole"
    actions   = ["dsql:DbConnect"]
    resources = [aws_dsql_cluster.main.arn]
  }
  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameters"]
    resources = [for n in local.secrets.ingest : "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}${n}"]
  }
}

module "api" {
  source      = "../modules/lambda_function"
  name        = local.api_name
  description = "jobtracker HTTP API (FastAPI). Every route but /api/health and /api/auth/config needs a Cognito ID token."
  handler     = "jobtracker.lambdas.handlers.api"
  zip_path    = var.lambda_zip
  memory_mb   = 1024 # more CPU for the cold start
  timeout_s   = 60   # = CloudFront's origin read timeout; the paste assistant waits on the LLM
  environment = merge(local.common_env, {
    DSQL_USER              = "jobtracker_api"
    SSM_SECRETS            = join(",", local.secrets.api)
    INGEST_FUNCTION_NAME   = local.ingest_name
    DISCOVER_FUNCTION_NAME = local.discover_name
    COGNITO_USER_POOL_ID   = aws_cognito_user_pool.main.id
    COGNITO_CLIENT_ID      = aws_cognito_user_pool_client.web.id
    COGNITO_DOMAIN         = local.login_domain
    APP_URL                = "https://${var.domain}"
  })
  policy_json        = data.aws_iam_policy_document.api.json
  log_retention_days = var.log_retention_days
}

module "ingest" {
  source      = "../modules/lambda_function"
  name        = local.ingest_name
  description = "jobtracker mail + calendar ingest. Reads Gmail over IMAP; paid LLM calls for job mail."
  handler     = "jobtracker.lambdas.handlers.ingest"
  zip_path    = var.lambda_zip
  memory_mb   = 512
  timeout_s   = 600
  environment = merge(local.common_env, {
    DSQL_USER   = "jobtracker_ingest"
    SSM_SECRETS = join(",", local.secrets.ingest)
  })
  policy_json = data.aws_iam_policy_document.ingest.json
  # No reserved concurrency: the account limit is 10, and AWS won't reserve any below 100.
  # One run at a time comes from the lease in DSQL instead (migration 0010, handlers.ingest):
  # a run that finds it taken returns {"busy": true} without reading mail.
  log_retention_days = var.log_retention_days
}

# Scheduled runs are async invokes. A failed run isn't retried (the next one in 15 minutes
# resumes from the checkpoint, so a retry would only repeat paid LLM calls), and an event that
# waited 10 minutes (Lambda throttled) is dropped: the next schedule covers it.
resource "aws_lambda_function_event_invoke_config" "ingest" {
  function_name                = module.ingest.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 600
}

data "aws_iam_policy_document" "discover" {
  statement {
    sid       = "ConnectToDsqlAsAppRole"
    actions   = ["dsql:DbConnect"]
    resources = [aws_dsql_cluster.main.arn]
  }
  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["ssm:GetParameters"]
    resources = [for n in local.secrets.discover : "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}${n}"]
  }
}

module "discover" {
  source      = "../modules/lambda_function"
  name        = local.discover_name
  description = "jobtracker job discovery: reads job boards, paid LLM calls to score new postings; daily digest by email."
  handler     = "jobtracker.lambdas.handlers.discover"
  zip_path    = var.lambda_zip
  memory_mb   = 1024 # parsing ~460 boards' JSON, 8 at a time
  timeout_s   = 900  # Lambda's maximum; scoring stops 2 minutes before it (what's left waits)
  environment = merge(local.common_env, {
    DSQL_USER   = "jobtracker_discover"
    SSM_SECRETS = join(",", local.secrets.discover)
    APP_URL     = "https://${var.domain}" # the digest's links
  })
  policy_json = data.aws_iam_policy_document.discover.json
  # One run at a time comes from its own lease in DSQL ("discover"), like the ingest's.
  log_retention_days = var.log_retention_days
}

# Scheduled runs and the page's are async invokes. A failed one isn't retried (it would pay for
# the same LLM calls again; the next run in 6 hours picks up what's left).
resource "aws_lambda_function_event_invoke_config" "discover" {
  function_name                = module.discover.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 900
}

# The API's Function URL accepts only SigV4-signed calls, i.e. CloudFront through OAC
# (cdn.tf). A direct call gets 403 from AWS before the code runs.
resource "aws_lambda_function_url" "api" {
  function_name      = module.api.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}
