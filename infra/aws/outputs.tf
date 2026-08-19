output "alb_dns_name" {
  description = "Public URL for the deployed app — the web frontend and /api/* both live here."
  value       = "http://${aws_lb.main.dns_name}"
}

output "ecr_agent_repository_url" {
  value = aws_ecr_repository.agent.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecr_retrieval_repository_url" {
  value = aws_ecr_repository.retrieval.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}
