output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "bucket_name" {
  description = "S3 bucket name for image uploads"
  value       = aws_s3_bucket.uploads.bucket
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.image_generator.function_name
}
