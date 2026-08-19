resource "aws_security_group" "alb" {
  name        = "${var.project_name}-alb"
  description = "Public ALB — HTTP/HTTPS from the internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-alb" }
}

resource "aws_security_group" "web" {
  name        = "${var.project_name}-web"
  description = "web (nginx) tasks — reachable only from the ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-web" }
}

resource "aws_security_group" "agent" {
  name        = "${var.project_name}-agent"
  description = "agent service — reachable from the ALB (public API) and calls out to the retrieval service + Anthropic"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 8787
    to_port         = 8787
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-agent" }
}

resource "aws_security_group" "retrieval" {
  name        = "${var.project_name}-retrieval"
  description = "retrieval service — internal only, reachable from the agent service via Cloud Map"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from agent service"
    from_port       = 8100
    to_port         = 8100
    protocol        = "tcp"
    security_groups = [aws_security_group.agent.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-retrieval" }
}

resource "aws_security_group" "efs" {
  name        = "${var.project_name}-efs"
  description = "EFS mount targets — NFS from agent and retrieval tasks only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "NFS from agent"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.agent.id]
  }

  ingress {
    description     = "NFS from retrieval"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.retrieval.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-efs" }
}
