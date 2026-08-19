resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/${var.project_name}/agent"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${var.project_name}/web"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "retrieval" {
  name              = "/ecs/${var.project_name}/retrieval"
  retention_in_days = 30
}
