<#
.SYNOPSIS
    Deploys the aws-ai-app end-to-end using Node/Terraform/AWS CLI.

.DESCRIPTION
    This script builds the React frontend, packages and deploys the Lambda
    function, and provisions all infrastructure via Terraform. After the
    infrastructure is deployed it writes a local environment file for the
    frontend containing the API gateway URL.

.PARAMETER BucketName
    A globally-unique S3 bucket name to use for image uploads.  This value is
    passed to Terraform as the "bucket_name" variable.

.EXAMPLE
    .\deploy.ps1 -BucketName "dmh-app-prod1-bucket"

.NOTES
    - Requires Terraform >= 1.5, Node >= 18, and the AWS CLI to be configured
      ("aws configure" must have been run).
    - Run from the repository root (the same directory as this script).
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$BucketName,

    [Parameter(Mandatory = $false)]
    [string]$Region = $null,

    [Parameter(Mandatory = $false)]
    [string]$BedrockModelAlias = $null
)

# If a region wasn't provided explicitly, we'll figure it out later (e.g. by
# querying an existing bucket). Terraform defaults to us-east-1 otherwise.

# ensure terraform executable can be located even if not on PATH
$workspaceTerraform = Join-Path -Path "C:\workspace" -ChildPath "terraform.exe"
if (-not (Get-Command terraform -ErrorAction SilentlyContinue) -and (Test-Path $workspaceTerraform)) {
    Write-Host "Adding C:\\workspace to PATH because terraform.exe was found there." -ForegroundColor Yellow
    $env:PATH = "C:\workspace;" + $env:PATH
}

function Check-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Error "Required command '$Name' was not found in PATH."
        exit 1
    }
}

# The Check-Command helper is used to validate required CLI tools.
# It will fail fast if any are missing after the PATH adjustment above.

# verify prerequisites
Check-Command -Name terraform
Check-Command -Name node
Check-Command -Name npm
Check-Command -Name aws

# build frontend
Write-Host "
=== Building frontend ===
" -ForegroundColor Cyan
Push-Location frontend
npm install
npm run build
Pop-Location

# sync built assets to S3 (same bucket as uploads)
Write-Host "
=== Uploading frontend to S3 ===
" -ForegroundColor Cyan
# ensure we know the bucket region/availability first by querying same as earlier
if (-not $Region) {
    try {
        aws s3api head-bucket --bucket $BucketName | Out-Null
        $bucketLoc = aws s3api get-bucket-location --bucket $BucketName --query "LocationConstraint" --output text
        if ($bucketLoc -eq "None") { $bucketLoc = "us-east-1" }
        $Region = $bucketLoc
    } catch {
        # ignore
    }
}

# perform sync (makes private objects)
aws s3 sync "frontend/dist" "s3://$BucketName/" --delete --region $Region

# deploy infra via Terraform
Write-Host "
=== Deploying infrastructure ===
" -ForegroundColor Cyan
Push-Location terraform

# determine region for Terraform
if (-not $Region) {
    # if bucket exists, query its region
    try {
        aws s3api head-bucket --bucket $BucketName | Out-Null
        $bucketLoc = aws s3api get-bucket-location --bucket $BucketName --query "LocationConstraint" --output text
        if ($bucketLoc -eq "None") { $bucketLoc = "us-east-1" }
        Write-Host "Detected existing bucket in region $bucketLoc" -ForegroundColor Yellow
        $Region = $bucketLoc
        # import into terraform state if not already
        terraform init
        # build var list with region if known
        $importVars = @("-var", "bucket_name=$BucketName")
        if ($Region) { $importVars += ("-var", "aws_region=$Region") }
        try {
            terraform import @importVars aws_s3_bucket.uploads $BucketName 2>$null
            Write-Host "Imported existing bucket into Terraform state" -ForegroundColor Cyan
        } catch {
            Write-Host "Bucket already imported or cannot import" -ForegroundColor Cyan
        }
    } catch {
        # bucket does not exist or inaccessible, leave region as-is
    }
}

$tfVars = @("-var", "bucket_name=$BucketName")
if ($Region) { $tfVars += ("-var", "aws_region=$Region") }
if ($BedrockModelAlias) { $tfVars += ("-var", "bedrock_model_alias=$BedrockModelAlias") }

terraform init
terraform plan @tfVars
terraform apply -auto-approve @tfVars
$apiEndpoint = terraform output -raw api_endpoint
Pop-Location

if (-not $apiEndpoint) {
    Write-Warning "Could not read API endpoint from Terraform output."
} else {
    # write frontend environment file
    $envFilePath = Join-Path -Path $PSScriptRoot -ChildPath "frontend/.env.local"
    "VITE_API_URL=$apiEndpoint" | Out-File -Encoding utf8 -FilePath $envFilePath
    Write-Host "Wrote frontend config to $envFilePath"
    Write-Host "
Deployment complete!" -ForegroundColor Green
    Write-Host "API Gateway URL: $apiEndpoint"
}
