# EventBridge Scheduler → ingest every 15 minutes (var.ingest_schedule_enabled: each run reads the
# real inbox and can make paid LLM calls), and → discover every 6 hours plus the 09:00 digest
# (var.discover_schedule_enabled: each run scores new postings with paid LLM calls).

locals {
  schedule_name = "${local.name}-ingest"
}

# Our own group, because Scheduler's trust condition can only name a group, not a schedule.
resource "aws_scheduler_schedule_group" "main" {
  name = local.name
}

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    # Scheduler sends the schedule *group* ARN here; the docs say not to name a schedule.
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:scheduler:${local.region}:${local.account_id}:schedule-group/${local.name}"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  description        = "EventBridge Scheduler invoking the ingest and discover functions"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [module.ingest.function_arn, module.discover.function_arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "invoke-ingest"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "ingest" {
  name                = local.schedule_name
  group_name          = aws_scheduler_schedule_group.main.name
  description         = "Incremental mail + calendar ingest"
  schedule_expression = "rate(15 minutes)"
  state               = var.ingest_schedule_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = module.ingest.function_arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ trigger = "schedule" })
    retry_policy {
      maximum_retry_attempts       = 0 # the next run is 15 minutes away
      maximum_event_age_in_seconds = 300
    }
  }
}

# Job discovery in Buenos Aires time: 02, 08, 14 and 20 h. Each run reads ~460 boards plus the
# saved searches (free) and scores what's new (paid, about $0.0005 a posting).
resource "aws_scheduler_schedule" "discover" {
  name                         = "${local.name}-discover"
  group_name                   = aws_scheduler_schedule_group.main.name
  description                  = "Job discovery: collect and score"
  schedule_expression          = "cron(0 2,8,14,20 * * ? *)"
  schedule_expression_timezone = "America/Buenos_Aires"
  state                        = var.discover_schedule_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = module.discover.function_arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ action = "run", trigger = "schedule" })
    retry_policy {
      maximum_retry_attempts       = 0 # the next run is 6 hours away
      maximum_event_age_in_seconds = 900
    }
  }
}

# The digest at 09:00, an hour after the morning run: the matches and maybes not sent yet. No LLM
# call; a day with nothing new sends nothing.
resource "aws_scheduler_schedule" "digest" {
  name                         = "${local.name}-digest"
  group_name                   = aws_scheduler_schedule_group.main.name
  description                  = "Daily discovery digest by email"
  schedule_expression          = "cron(0 9 * * ? *)"
  schedule_expression_timezone = "America/Buenos_Aires"
  state                        = var.discover_schedule_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = module.discover.function_arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ action = "digest", trigger = "schedule" })
    retry_policy {
      maximum_retry_attempts       = 2 # cheap, and a missed digest waits a whole day
      maximum_event_age_in_seconds = 3600
    }
  }
}
