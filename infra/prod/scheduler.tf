# EventBridge Scheduler → ingest every 15 minutes. Created DISABLED (var.ingest_schedule_enabled):
# each run reads the real inbox and can make paid LLM calls.

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
  description        = "EventBridge Scheduler invoking ${module.ingest.function_name}"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [module.ingest.function_arn]
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
