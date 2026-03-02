import json
import base64
import os
import boto3
import mimetypes

s3_client = boto3.client("s3")

# allow specifying a separate region/model for Bedrock invocations
BEDROCK_REGION = os.environ.get("BEDROCK_REGION") or os.environ.get("AWS_REGION") or boto3.session.Session().region_name or "us-east-1"
MODEL_ID = os.environ.get("MODEL_ID", "")

# if no MODEL_ID given, default to Titan image generator ID and
# call it from a region where image editing is available (us-east-1)
if not MODEL_ID:
    # the runtime client may still operate in BEDROCK_REGION, but the
    # model itself should be the Titan image generator which is only
    # available in us-east-1 today.
    MODEL_ID = "amazon.titan-image-generator-v2:0"
    # ensure region matches availability
    BEDROCK_REGION = "us-east-1"

# create the Bedrock runtime client once using the final region
bedrock_client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

BUCKET_NAME = os.environ["BUCKET_NAME"]
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

    if path.endswith("/fetch") and method == "POST":
        return handle_fetch(event)

    # not an API route; attempt to serve from S3 as a static asset
    # strip leading slash
    key = path.lstrip("/")
    if key == "":
        key = "index.html"

    try:
        s3_resp = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
        body_bytes = s3_resp["Body"].read()
        content_type = s3_resp.get("ContentType") or mimetypes.guess_type(key)[0] or "application/octet-stream"
        return {
            "statusCode": 200,
            "headers": {"Content-Type": content_type},
            "body": base64.b64encode(body_bytes).decode("utf-8"),
            "isBase64Encoded": True,
        }
    except s3_client.exceptions.NoSuchKey:
        return {
            "statusCode": 404,
            "headers": {"Content-Type": "text/plain"},
            "body": "Not Found",
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


def handle_fetch(event):
    body = json.loads(event.get("body") or "{}")
    key = body.get("key")
    if not key:
        return {"statusCode": 400, "headers": CORS_HEADERS, "body": json.dumps({"error": "Missing key"})}

    url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET_NAME, "Key": key},
        ExpiresIn=PRESIGN_EXPIRY,
    )
    return {"statusCode": 200, "headers": CORS_HEADERS, "body": json.dumps({"url": url, "key": key})}


import uuid

def handle_generate(event):
    body = json.loads(event.get("body") or "{}")
    key = body.get("key")
    prompt = body.get("prompt", "")

    # if a key was provided we perform the original image variation/inpainting path
    if key:
        # ensure there's at least some text for the prompt
        if not prompt:
            prompt = "Generate a creative variation of this image"

        # Read uploaded image from S3 and base64 encode it
        s3_response = s3_client.get_object(Bucket=BUCKET_NAME, Key=key)
        image_bytes = s3_response["Body"].read()
        image_base64 = base64.b64encode(image_bytes).decode("utf-8")

        # build inpainting parameters according to the Titan example helper
        # if the caller supplied a mask prompt or mask image we will run an
        # explicit INPAINTING task; otherwise we fall back to an image
        # variation, which does not require a mask and accepts a simple prompt.
        config = {
            "numberOfImages": body.get("numberOfImages", 1),
            "width": body.get("width", 512),
            "height": body.get("height", 512),
            "cfgScale": body.get("cfgScale", 8.0),
        }
        if "seed" in body:
            config["seed"] = body["seed"]

        if "maskPrompt" in body or "maskImage" in body:
            inpaint_params = {
                "image": image_base64,
                "text": prompt,
                "negativeText": body.get(
                    "negativeText",
                    "different person, different face, changed facial structure, deformed, extra limbs, blurry, low quality",
                ),
            }
            if "maskPrompt" in body:
                inpaint_params["maskPrompt"] = body["maskPrompt"]
            if "maskImage" in body:
                inpaint_params["maskImage"] = body["maskImage"]

            bedrock_request = {
                "taskType": "INPAINTING",
                "inPaintingParams": inpaint_params,
                "imageGenerationConfig": config,
            }
        else:
            # no mask: perform a simple image variation with optional prompt
            bedrock_request = {
                "taskType": "IMAGE_VARIATION",
                "image": image_base64,
                "imageGenerationConfig": config,
            }
            if prompt:
                bedrock_request["text"] = prompt

        try:
            bedrock_response = bedrock_client.invoke_model(
                modelId=MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(bedrock_request),
            )
            result = json.loads(bedrock_response["body"].read())
            generated_image_b64 = result["images"][0]
        except Exception as e:
            details = str(e)
            # for debugging, capture the request payload without the raw image
            safe_request = dict(bedrock_request)
            if "inPaintingParams" in safe_request:
                ip = dict(safe_request["inPaintingParams"])
                ip["image"] = "<omitted>"
                safe_request["inPaintingParams"] = ip

            # content filter blocks – user prompt triggered Bedrock safety
            if "blocked by our content filters" in details.lower():
                return {
                    "statusCode": 400,
                    "headers": CORS_HEADERS,
                    "body": json.dumps({
                        "error": "Prompt blocked",
                        "details": (
                            "The text prompt was flagged by Bedrock’s content filters. "
                            "Please revise the prompt to comply with AWS Responsible AI "
                            "policies and try again."
                        ),
                        "model_alias": MODEL_ID,
                        "request": safe_request,
                    }),
                }
            # mask-prompt failure: Bedrock couldn’t create a mask from the prompt
            if "Unable to auto-generate mask image" in details:
                return {
                    "statusCode": 400,
                    "headers": CORS_HEADERS,
                    "body": json.dumps({
                        "error": "Mask generation failed",
                        "details": (
                            "Bedrock was unable to create a mask from your prompt. "
                            "Try simplifying the mask text or provide a manual `maskImage` "
                            "(base64 black/white image) instead."
                        ),
                        "model_alias": MODEL_ID,
                        "request": safe_request,
                    }),
                }
            # common error when input image exceeds the service limit
            if "maximum length" in details and "input image" in details:
                return {
                    "statusCode": 400,
                    "headers": CORS_HEADERS,
                    "body": json.dumps({
                        "error": "Input image too large",
                        "details": (
                            "Bedrock rejected the image because it exceeds the "
                            "maximum allowed dimensions (~1408). Resize the image "
                            "to smaller dimensions before uploading."
                        ),
                        "model_alias": MODEL_ID,
                        "request": safe_request,
                    }),
                }
            return {
                "statusCode": 500,
                "headers": CORS_HEADERS,
                "body": json.dumps({
                    "error": "Bedrock invocation failed",
                    "details": details,
                    "model_alias": MODEL_ID,
                    "request": safe_request,
                }),
            }

        # store result to S3 so client can later fetch by key
        out_key = f"generated/{uuid.uuid4()}.png"
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=out_key,
            Body=base64.b64decode(generated_image_b64),
            ContentType="image/png",
        )
        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "imageData": generated_image_b64,
                "s3Key": out_key,
                "model_alias": MODEL_ID,
            }),
        }
    else:
        # text generation path (Nova and friends)
        if not prompt.strip():
            return {
                "statusCode": 400,
                "headers": CORS_HEADERS,
                "body": json.dumps({"error": "Missing required field: prompt"}),
            }

        # simple text request; other models may expect different shapes
        bedrock_request = {"inputText": prompt}

        try:
            bedrock_response = bedrock_client.invoke_model(
                modelId=MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(bedrock_request),
            )
            result = json.loads(bedrock_response["body"].read())
            output_text = result.get("outputText") or result.get("content") or ""
        except Exception as e:
            return {
                "statusCode": 500,
                "headers": CORS_HEADERS,
                "body": json.dumps({
                    "error": "Bedrock invocation failed",
                    "details": str(e),
                    "model_alias": MODEL_ID,
                }),
            }

        return {
            "statusCode": 200,
            "headers": CORS_HEADERS,
            "body": json.dumps({
                "outputText": output_text,
                "model_alias": MODEL_ID,
            }),
        }
