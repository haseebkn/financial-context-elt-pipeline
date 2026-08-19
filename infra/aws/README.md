# AWS Deployment (Terraform)

Deploys the three containers built by [`agent/Dockerfile`](../../agent/Dockerfile), [`web/Dockerfile`](../../web/Dockerfile), and [`vector_prep/Dockerfile`](../../vector_prep/Dockerfile) onto ECS Fargate, behind one public ALB.

## Architecture

```
Internet
   │
   ▼
ALB (port 80)
   ├── /api/*  ──▶  agent Fargate service (port 8787) ──▶  retrieval Fargate service (port 8100, internal-only via Cloud Map)
   └── /*      ──▶  web Fargate service (nginx, port 80)

agent + retrieval both mount an EFS access point:
   agent      ──▶  /data           (financial_engine.db, read-only DuckDB queries)
   retrieval  ──▶  /repo/vector_store  (ChromaDB persistence)
```

- **No NAT gateway.** Fargate tasks run in public subnets with public IPs and security-group-restricted ingress, saving the ~$32/mo a NAT gateway would cost. This is a reasonable trade for a single-service portfolio deploy — not a pattern to copy for a workload handling real financial data.
- **No RDS.** The warehouse is a DuckDB file on EFS, matching how it already runs locally — one writer (dbt/the extractors, run out-of-band, not deployed here), many readers (the agent's tools).
- **No HTTPS by default.** The ALB listens on port 80 only. Point a domain at `alb_dns_name`, request an ACM certificate, and add a port-443 listener before this serves anything beyond a demo.

## What's deployed vs. what isn't

Terraform here provisions the **serving path**: the agent's chat API, the retrieval service, and the web frontend. It does **not** run the ingestion pipeline (`extract/`), dbt builds, or the embedding backfill (`vector_prep/embed_context.py`) — those populate `financial_engine.db` and the ChromaDB store, which then need to land on the EFS volumes this stack creates (e.g. via a one-off `aws efs` mount from a bastion, or a scheduled ECS task — not included, since running the actual ingestion against live brokerage/bank APIs from a shared cloud environment is a separate decision from standing up the serving infrastructure).

## Setup

```bash
cd infra/aws
terraform init
cp terraform.tfvars.example terraform.tfvars   # fill in real secrets, don't commit it
terraform plan
terraform apply
```

Requires AWS credentials in the environment (`aws configure`, or `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) with permissions to create VPC, ECS, ECR, EFS, ALB, IAM, Secrets Manager, Cloud Map, and CloudWatch Logs resources.

## Building and pushing images

```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker build -f agent/Dockerfile -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/financial-context/agent:latest .
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/financial-context/agent:latest

docker build -f web/Dockerfile -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/financial-context/web:latest .
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/financial-context/web:latest

docker build -f vector_prep/Dockerfile -t <account-id>.dkr.ecr.us-east-1.amazonaws.com/financial-context/retrieval:latest .
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/financial-context/retrieval:latest
```

Then force a new deployment so the running services pick up the new image:

```bash
aws ecs update-service --cluster financial-context-cluster --service financial-context-agent --force-new-deployment
aws ecs update-service --cluster financial-context-cluster --service financial-context-web --force-new-deployment
aws ecs update-service --cluster financial-context-cluster --service financial-context-retrieval --force-new-deployment
```

See [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) for a CI workflow that automates the build/push/redeploy steps on manual dispatch.

## Cost

Rough monthly estimate at the default `var.*_cpu`/`var.*_memory` sizing, `desired_count = 1` each, us-east-1, no traffic-driven autoscaling: Fargate compute (~$45–55), ALB (~$18 + data processing), EFS (~$1–5 depending on data size), ECR storage (~$1), CloudWatch Logs (~$1–5). Roughly **$70–90/mo** — dominated by the ALB and always-on Fargate tasks, not by usage. Scaling `desired_count` to 0 for the agent/retrieval services when not actively demoing removes most of the Fargate cost.

## Tearing down

```bash
terraform destroy
```
