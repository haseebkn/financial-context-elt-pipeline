terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # No remote backend configured — state is local by default, which is fine
  # for a single-operator portfolio deploy. A team would add an S3 backend
  # + DynamoDB lock table here before a second person ever runs `apply`:
  #
  # backend "s3" {
  #   bucket         = "financial-context-tfstate"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "financial-context-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
}
