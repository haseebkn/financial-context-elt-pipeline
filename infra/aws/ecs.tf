resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# --- retrieval service (internal only) ---------------------------------

resource "aws_ecs_task_definition" "retrieval" {
  family                   = "${var.project_name}-retrieval"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.retrieval_cpu
  memory                   = var.retrieval_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  volume {
    name = "vector-store"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.vector_store.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = "retrieval"
    image     = "${aws_ecr_repository.retrieval.repository_url}:${var.retrieval_image_tag}"
    essential = true
    portMappings = [{
      containerPort = 8100
      protocol      = "tcp"
    }]
    mountPoints = [{
      sourceVolume  = "vector-store"
      containerPath = "/repo/vector_store"
    }]
    secrets = [{
      name      = "RETRIEVAL_SERVICE_TOKEN"
      valueFrom = aws_secretsmanager_secret.retrieval_service_token.arn
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.retrieval.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "retrieval"
      }
    }
  }])
}

resource "aws_ecs_service" "retrieval" {
  name            = "${var.project_name}-retrieval"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.retrieval.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.retrieval.id]
    assign_public_ip = true
  }

  service_registries {
    registry_arn = aws_service_discovery_service.retrieval.arn
  }
}

# --- agent service (behind ALB at /api/*) -------------------------------

resource "aws_ecs_task_definition" "agent" {
  family                   = "${var.project_name}-agent"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.agent_cpu
  memory                   = var.agent_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  volume {
    name = "warehouse"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.warehouse.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = "agent"
    image     = "${aws_ecr_repository.agent.repository_url}:${var.agent_image_tag}"
    essential = true
    portMappings = [{
      containerPort = 8787
      protocol      = "tcp"
    }]
    mountPoints = [{
      sourceVolume  = "warehouse"
      containerPath = "/data"
    }]
    environment = [
      { name = "DUCKDB_PATH", value = "/data/financial_engine.db" },
      { name = "RETRIEVAL_SERVICE_URL", value = "http://retrieval.internal:8100" },
    ]
    secrets = [
      { name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },
      { name = "RETRIEVAL_SERVICE_TOKEN", valueFrom = aws_secretsmanager_secret.retrieval_service_token.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.agent.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "agent"
      }
    }
  }])
}

resource "aws_ecs_service" "agent" {
  name            = "${var.project_name}-agent"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.agent.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.agent.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.agent.arn
    container_name   = "agent"
    container_port   = 8787
  }

  depends_on = [aws_lb_listener.http, aws_ecs_service.retrieval]
}

# --- web frontend (behind ALB, default route) ---------------------------

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project_name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = "${aws_ecr_repository.web.repository_url}:${var.web_image_tag}"
    essential = true
    portMappings = [{
      containerPort = 80
      protocol      = "tcp"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "${var.project_name}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 80
  }

  depends_on = [aws_lb_listener.http]
}
