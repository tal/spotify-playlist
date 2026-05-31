# AWS Infrastructure Configuration

Everything needed to recreate the AWS setup for `spotify-playlist-dev` from scratch.

**Region:** `us-east-1`

---

## 1. IAM Role

**Name:** `spotify-playlist-dev-us-east-1-lambdaRole`

**Trust Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

**Attached AWS Managed Policies:**
- `AWSLambdaExecute`
- `CloudWatchLogsFullAccess`
- `AWSXrayFullAccess`
- `AWSKeyManagementServicePowerUser`
- `AmazonDynamoDBFullAccess`

**Custom Inline Policy** (X-Ray trace submission):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
    "Resource": ["*"]
  }]
}
```

---

## 2. Lambda Function

```bash
aws lambda create-function \
  --function-name spotify-playlist-dev \
  --runtime nodejs20.x \
  --handler dist/index.handler \
  --role arn:aws:iam::<ACCOUNT_ID>:role/spotify-playlist-dev-us-east-1-lambdaRole \
  --memory-size 128 \
  --timeout 80 \
  --architectures x86_64 \
  --tracing-config Mode=Active \
  --environment "Variables={NODE_ENV=prod,SPOTIFY_CLIENT_ID=<value>,SPOTIFY_CLIENT_SECRET=<value>}" \
  --zip-file fileb://index.zip
```

**Reserved Concurrency:**
```bash
aws lambda put-function-concurrency \
  --function-name spotify-playlist-dev \
  --reserved-concurrent-executions 1
```

---

## 3. Lambda Function URL

```bash
aws lambda create-function-url-config \
  --function-name spotify-playlist-dev \
  --auth-type NONE \
  --invoke-mode BUFFERED \
  --cors '{
    "AllowOrigins": ["*"],
    "AllowMethods": ["*"],
    "AllowHeaders": ["*"],
    "MaxAge": 86400
  }'
```

**Resource-based policy for public access:**
```bash
aws lambda add-permission \
  --function-name spotify-playlist-dev \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE
```

---

## 4. EventBridge Rule (Scheduled Trigger)

Runs `frequent-crawling` (archive + playback history + triage + inbox scan + smart playlists) every 6 hours.

```bash
aws events put-rule \
  --name Archive-Trigger \
  --schedule-expression "rate(6 hours)" \
  --state ENABLED

aws events put-targets \
  --rule Archive-Trigger \
  --targets '[{
    "Id": "spotify-playlist-dev",
    "Arn": "arn:aws:lambda:us-east-1:<ACCOUNT_ID>:function:spotify-playlist-dev",
    "Input": "{\"type\":\"scheduled\",\"schedule\":\"frequent-crawling\",\"queryStringParameters\":{\"action\":\"frequent-crawling\"}}"
  }]'
```

**Grant EventBridge permission to invoke the Lambda:**
```bash
aws lambda add-permission \
  --function-name spotify-playlist-dev \
  --statement-id EventBridgeArchiveTrigger \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:us-east-1:<ACCOUNT_ID>:rule/Archive-Trigger
```

---

## 5. DynamoDB Tables

### `user`
```bash
aws dynamodb create-table \
  --table-name user \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1
```

### `track`
```bash
aws dynamodb create-table \
  --table-name track \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1
```

### `action_history`
```bash
aws dynamodb create-table \
  --table-name action_history \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=created_at,AttributeType=N \
  --key-schema \
    AttributeName=id,KeyType=HASH \
    AttributeName=created_at,KeyType=RANGE \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1
```

### `liked_songs`
```bash
aws dynamodb create-table \
  --table-name liked_songs \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
    AttributeName=trackId,AttributeType=S \
    AttributeName=addedAt,AttributeType=N \
  --key-schema \
    AttributeName=userId,KeyType=HASH \
    AttributeName=trackId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName": "userId-addedAt-index",
    "KeySchema": [
      {"AttributeName": "userId", "KeyType": "HASH"},
      {"AttributeName": "addedAt", "KeyType": "RANGE"}
    ],
    "Projection": {"ProjectionType": "ALL"}
  }]'
```

### `liked_songs_metadata`
```bash
aws dynamodb create-table \
  --table-name liked_songs_metadata \
  --attribute-definitions AttributeName=userId,AttributeType=S \
  --key-schema AttributeName=userId,KeyType=HASH \
  --billing-mode PROVISIONED \
  --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1
```

---

## 6. CloudWatch Logs

```bash
aws logs create-log-group \
  --log-group-name /aws/lambda/spotify-playlist-dev

aws logs put-retention-policy \
  --log-group-name /aws/lambda/spotify-playlist-dev \
  --retention-in-days 731
```

---

## 7. Legacy Integrations (informational)

These exist in the resource policy but may no longer be actively used:

- **API Gateway:** `ovgepxasb9` — original API Gateway endpoint before Function URL migration
- **Alexa Skill:** `amzn1.ask.skill.b2338818-8dca-4c9a-9810-51a06211f0af`

---

## 8. Deployment

Deploy is handled by `scripts/publish.rb`:

```bash
# Build React frontend
cd web && bun run build && cd ..

# Compile TypeScript
npx tsc

# Create zip (excludes .env, .git, dynamodb_local_latest, web source/node_modules, markdown, scripts)
zip -r index.zip . -x ".env" ".git/*" "dynamodb_local_latest/*" "node_modules/typescript/*" "web/node_modules/*" "web/src/*" "*.md" "scripts/*"

# Deploy
aws lambda update-function-code \
  --function-name spotify-playlist-dev \
  --zip-file fileb://index.zip
```

---

## Quick Recreation Checklist

1. Create IAM role with trust policy and attach managed policies
2. Create all 5 DynamoDB tables (with GSI on `liked_songs`)
3. Create Lambda function with environment variables
4. Set reserved concurrency to 1
5. Create Function URL with public access and CORS
6. Create EventBridge rule `Archive-Trigger` at `rate(6 hours)`
7. Grant EventBridge permission to invoke Lambda
8. Set CloudWatch log retention to 731 days
9. Deploy code via `ruby scripts/publish.rb`
