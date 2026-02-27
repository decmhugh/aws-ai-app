variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Application name used as prefix for resource names"
  type        = string
  default     = "aws-ai-app"
}

variable "bucket_name" {
  description = "S3 bucket name for image uploads"
  type        = string
  default     = "aws-ai-app-uploads"
}

variable "bedrock_model_alias" {
  description = "Amazon Bedrock Titan Image Generator model alias (cross-region inference profile)"
  type        = string
  default     = "us.amazon.titan-image-generator-v1:0"
}

variable "cors_allowed_origins" {
  description = "Allowed origins for CORS (restrict to your frontend domain in production)"
  type        = list(string)
  default     = ["*"]
}
