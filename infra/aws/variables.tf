variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used to prefix all resources."
  type        = string
  default     = "financial-context"
}

variable "environment" {
  description = "Deployment environment tag (prod, staging, ...)."
  type        = string
  default     = "prod"
}

variable "anthropic_api_key" {
  description = "Claude API key for the agent service. Stored in Secrets Manager, never in state-readable plaintext outputs."
  type        = string
  sensitive   = true
}

variable "retrieval_service_token" {
  description = "Shared-secret bearer token the agent service uses to call the retrieval service."
  type        = string
  sensitive   = true
}

variable "agent_image_tag" {
  description = "Image tag to deploy for the agent service (set by CI after a successful build/push)."
  type        = string
  default     = "latest"
}

variable "web_image_tag" {
  description = "Image tag to deploy for the web service."
  type        = string
  default     = "latest"
}

variable "retrieval_image_tag" {
  description = "Image tag to deploy for the retrieval service."
  type        = string
  default     = "latest"
}

variable "agent_cpu" {
  description = "Fargate task CPU units for the agent service."
  type        = number
  default     = 512
}

variable "agent_memory" {
  description = "Fargate task memory (MiB) for the agent service."
  type        = number
  default     = 1024
}

variable "retrieval_cpu" {
  description = "Fargate task CPU units for the retrieval service — sentence-transformers on CPU wants more headroom than the agent."
  type        = number
  default     = 1024
}

variable "retrieval_memory" {
  description = "Fargate task memory (MiB) for the retrieval service."
  type        = number
  default     = 3072
}

variable "web_cpu" {
  description = "Fargate task CPU units for the static web frontend."
  type        = number
  default     = 256
}

variable "web_memory" {
  description = "Fargate task memory (MiB) for the static web frontend."
  type        = number
  default     = 512
}
