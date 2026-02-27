import json
import base64
import os
import boto3

s3_client = boto3.client("s3")
bedrock_client = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)

BUCKET_NAME = os.environ["BUCKET_NAME"]
MODEL_ALIAS = os.environ.get("MODEL_ALIAS", "us.amazon.titan-image-generator-v1:0")
PRESIGN_EXPIRY = int(os.environ.get("PRESIGN_EXPIRY_SECONDS", "300"))

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
}


def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "/")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    if path.endswith("/presign") and method == "POST":
        return handle_presign(event)

    if path.endswith("/generate") and method == "POST":
        return handle_generate(event)

    return {
        "statusCode": 404,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": "Not found"}),
    }


def handle_presign(event):
    body = json.loads(event.get("body") or "{}")
    filename = body.get("filename", "upload.jpg")
    content_type = body.get("contentType", "image/jpeg")
    key = f"uploads/{filename}"

    presigned_url = s3_client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": BUCKET_NAME,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=PRESIGN_EXPIRY,
    )

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps({"uploadUrl": presigned_url, "key": key}),
    }


def handle_generate(event):
    body = json.loads(event.get("body") or "{}")
    key = body.get("key")
    prompt = body.get("prompt", "Generate a creative variation of this image")

    if not key:
        return {
            "statusCode": 400,
            "headers": CORS_HEADERS,
            "body": json.dumps({"error": "Missing required field: key"}),
        }

    # Read uploaded image from S3
    s3_response = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
    image_bytes = s3_response["Body"].read()
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")

    # Invoke Bedrock Titan Image Generator using the model alias
    bedrock_request = {
        "taskType": "IMAGE_VARIATION",
        "imageVariationParams": {
            "text": prompt,
            "images": [image_base64],
        },
        "imageGenerationConfig": {
            "numberOfImages": 1,
            "width": 512,
            "height": 512,
            "cfgScale": 8.0,
        },
    }

    bedrock_response = bedrock_client.invoke_model(
        modelId=MODEL_ALIAS,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(bedrock_request),
    )

    result = json.loads(bedrock_response["body"].read())
    generated_image_b64 = result["images"][0]

    return {
        "statusCode": 200,
        "headers": CORS_HEADERS,
        "body": json.dumps({"imageData": generated_image_b64}),
    }
