# Private DNS namespace so the agent service can reach the retrieval
# service at a stable name (retrieval.internal) without going through the
# public ALB — the retrieval service is never exposed publicly.

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "retrieval" {
  name = "retrieval"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}
