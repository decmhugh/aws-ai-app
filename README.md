# aws-ai-app

AWS-powered AI image generation application using Amazon Bedrock Titan Image Generator.

## Architecture

```
React Frontend (S3 Uploader)
        │
        ▼
  API Gateway (HTTP API v2)
        │
        ▼
  Lambda Function (Python 3.12)
   ├── GET /presign  → returns S3 pre-signed PUT URL
   └── POST /generate → invokes Bedrock, returns generated image
        │
        ├──▶ S3 Bucket (image uploads)
        └──▶ Amazon Bedrock – Titan Image Generator
                 (model alias: us.amazon.titan-image-generator-v1:0)
```

## Prerequisites

- [Terraform](https://www.terraform.io/) >= 1.5
- [Node.js](https://nodejs.org/) >= 18
- AWS credentials configured (`aws configure`)
- Amazon Bedrock Titan Image Generator model enabled in your AWS account

## Infrastructure (Terraform)

```bash
cd terraform

# Initialise providers
terraform init

# Review the plan
terraform plan -var="bucket_name=my-unique-bucket-name"

# Deploy
terraform apply -var="bucket_name=my-unique-bucket-name"

# Note the API Gateway endpoint
terraform output api_endpoint
```

### Variables

| Name | Default | Description |
|------|---------|-------------|
| `aws_region` | `us-east-1` | AWS region |
| `app_name` | `aws-ai-app` | Prefix for resource names |
| `bucket_name` | `aws-ai-app-uploads` | **Must be globally unique** |
| `bedrock_model_alias` | `us.amazon.titan-image-generator-v1:0` | Bedrock model alias / inference profile |

## Lambda Function

Located in `lambda/handler.py`. Exposes two routes:

| Route | Description |
|-------|-------------|
| `POST /presign` | Returns a pre-signed S3 URL for direct browser → S3 upload |
| `POST /generate` | Reads uploaded image from S3 and calls Bedrock Titan Image Generator |

## Frontend (React + Vite)

```bash
cd frontend
npm install

# Copy the env template and set your API Gateway URL
cp .env.example .env.local
# Edit .env.local: VITE_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com

npm run dev      # development server
npm run build    # production build (output in dist/)
```

## Workflow

1. User selects an image in the browser.
2. Frontend requests a pre-signed S3 URL from `POST /presign`.
3. Frontend uploads the image directly to S3 using the pre-signed URL.
4. Frontend calls `POST /generate` with the S3 object key and an optional prompt.
5. Lambda reads the image, invokes Bedrock Titan Image Generator (IMAGE_VARIATION task), and returns the generated image as base64.
6. Frontend displays the generated image with a download link.

## Tear down

```bash
cd terraform
terraform destroy -var="bucket_name=my-unique-bucket-name"
```
