# Shared storage for the DuckDB warehouse file (agent's read-only tool
# queries) and the ChromaDB persistence directory (retrieval service).
# Neither needs high IOPS — EFS's per-file consistency and pay-per-GB
# pricing suit a single-writer, mostly-read workload far better than
# provisioning EBS + a sidecar sync process.

resource "aws_efs_file_system" "data" {
  creation_token   = "${var.project_name}-data"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "${var.project_name}-data" }
}

resource "aws_efs_mount_target" "data" {
  count           = length(aws_subnet.public)
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = aws_subnet.public[count.index].id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "warehouse" {
  file_system_id = aws_efs_file_system.data.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/warehouse"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${var.project_name}-warehouse-ap" }
}

resource "aws_efs_access_point" "vector_store" {
  file_system_id = aws_efs_file_system.data.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/vector_store"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "755"
    }
  }

  tags = { Name = "${var.project_name}-vector-store-ap" }
}
