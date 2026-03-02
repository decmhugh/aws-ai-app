# aws-ai-app

AWS-powered AI image generation application using Amazon Bedrock Titan Image Generator.

## Architecture

```
React Frontend (prompt entry)
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

> **Note:** the same S3 bucket used for image uploads will also host the
> built frontend files. The deploy script automatically syncs `frontend/dist`
> to the bucket once it’s built, and the Lambda function serves those assets
> on HTTP requests.
>
> **Bucket ownership:** if the specified `bucket_name` already exists and is
> owned by you, the script imports it into Terraform state rather than
> attempting to create a new one. Provide `-Region` to `deploy.ps1` to
> override the detected or default region, and/or pass
> `-BedrockModelAlias` to set a custom alias for the Titan Image Generator.
> Example:
>
> ```powershell
> .\deploy.ps1 -BucketName "my-bucket" -Region "eu-west-1" -BedrockModelAlias "eu-west-1.amazon.titan-image-generator-v1:0"
> ```

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
| `bedrock_model_alias` | `us.amazon.titan-image-generator-v1:0` | Bedrock model alias / inference profile (set the value appropriate for your account/region; you may need to enable the Titan Image Generator model in Bedrock first) |

## Lambda Function

Located in `lambda/handler.py`. Exposes two API routes plus a
catch-all proxy route that serves static files from S3:

The `/generate` route now handles two modes:

* **Image inpainting/variation** – when the JSON body contains a `key` field (i.e. when the user selected or uploaded an image), the handler retrieves the object from S3 and calls Bedrock. Behavior depends on whether a mask was supplied:

  * If the body includes `maskPrompt` or `maskImage`, an `INPAINTING` request is generated with a rich set of parameters:

  * `prompt` – text describing the edit (defaults to a generic variation message if omitted).
  * `negativeText` – optional instructions to discourage unwanted changes; a sensible default is supplied.
  * `maskPrompt` – describe areas of the image to alter (recommended for simple edits). Note that Bedrock may occasionally be unable to translate your prompt into a mask; in that case the API returns a 400 with guidance and you can either simplify the text or switch to `maskImage`.
  * `maskImage` – alternatively, provide a base64-encoded black/white mask.
  * `numberOfImages`, `width`, `height`, `cfgScale`, and `seed` – override generation configuration values.

  The handler assembles these into `inPaintingParams` (note capital **P**) and places the single base64 image in the request. This matches the official Titan helper example and avoids validation errors. Generated images are returned inline and also stored in S3 with a presigned fetch URL. Ensure the Lambda role is permitted to invoke the chosen Titan model (v1 or v2) or inference profile.

> **Content filters:** Bedrock applies safety checks to every prompt. If the
> service flags your text, the API replies with a 400 and a message indicating
> the prompt was blocked. In that case you’ll need to adjust the wording to
> comply with AWS’s Responsible AI policies and try again.
* **Text generation** – when no `key` is present the handler assumes a text model. It sends the prompt in `inputText` and returns the model’s `outputText` in the response. This is suitable for models such as Nova‑2‑Lite.

> The Terraform IAM policy now allows `bedrock:InvokeModel` on both the
> `amazon.titan-image-generator-v1` and `-v2` foundation models as well as
> any inference profile. Run `terraform apply` after updating if you alter the
> allowed resources.

The front end now presents a single text box: users may optionally drag‑and‑drop or click to choose an image and then enter their prompt. Uploaded images are stored in S3 and the prompt (plus the image key) is sent to Bedrock. A single instruction such as “add a beard to the person’s chin” is sufficient – no additional fields are shown or required. The same “Generate” button handles text and image requests; the UI shows either text output or an image, depending on what the backend returns.

| Route | Description |
|-------|-------------|
| `POST /presign` | (optional) Returns a pre-signed S3 URL for direct browser → S3 upload – not used when generating text |
| `POST /generate` | Accepts a prompt (and optional S3 key) and invokes the configured Bedrock model |

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

### Hosting

The frontend UI now allows either entering text or uploading an image (or both). If an image is supplied, the backend will perform an image variation; otherwise it runs a text model.


When you run `deploy.ps1` the built assets from `frontend/dist` are automatically
synced into the same S3 bucket that holds uploads. The Lambda function is
updated to serve any request that doesn't match `/presign` or `/generate`
by fetching the corresponding object from the bucket and returning it with an
appropriate `Content-Type`. This lets the API Gateway act as a simple static
file host without needing a separate web server.

Files are uploaded privately; the lambda reads them on demand. You can also
inspect the bucket contents manually if needed.

## Workflow

1. User enters a prompt in the form on the landing page and may optionally upload an image.
2. Frontend calls `POST /generate` with the prompt (and upload key if an image was supplied).
3. Lambda invokes Bedrock using the configured model alias – either performing an image variation or a text generation.
4. If an image is generated, the function stores it in S3 under `generated/` and returns the `s3Key` along with the base64 payload.

> **Image size limits:** Titan’s inpainting service enforces a maximum input image length (roughly 1408 pixels on the longest side). Very large uploads will result in a “maximum length…too long” error. The frontend automatically downsizes oversized pictures to 1024×1024, and the Lambda returns a clear 400 error if Bedrock still rejects the image. You can also manually resize/scale your source image before uploading.
5. Frontend detects the `s3Key` and issues a second call (`POST /fetch`) to the API to obtain a presigned GET URL.
6. The server responds with `{ url, key }`; the frontend then uses that URL as the image source (fallback to the inline data if signing fails).

## Tear down

```bash
cd terraform
terraform destroy -var="bucket_name=my-unique-bucket-name"
```
