# Update Lambda Function URL Permissions for New AWS Authorization Model

**Date:** 2025-10-30

## Summary

Updated the Lambda function URL permissions to comply with AWS's new authorization model, which requires both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` actions in permissions policies.

## Background

AWS Lambda announced changes to the Lambda function URL authorization model to improve security posture. The new model requires permissions policies to include both:
- `lambda:InvokeFunctionUrl` (previously required)
- `lambda:InvokeFunction` (newly required)

This change must be implemented by November 1, 2026 to avoid potential disruption to function URLs.

## Changes Made

### Permission Policy Updates

Updated the `spotify-playlist-dev` Lambda function's resource-based policy to include both required actions:

1. **Existing Statement (Updated):**
   - Statement ID: `FunctionURLAllowPublicAccess`
   - Action: `lambda:InvokeFunctionUrl`
   - Principal: `*` (public access)
   - Condition: Function URL auth type is `NONE`

2. **New Statement (Added):**
   - Statement ID: `FunctionURLInvokeFunction`
   - Action: `lambda:InvokeFunction`
   - Principal: `*` (public access)
   - No conditions (applies to all invocations)

### Implementation Details

The permissions were updated using the AWS CLI:

```bash
# Remove old permission statement
aws lambda remove-permission \
  --function-name spotify-playlist-dev \
  --statement-id FunctionURLAllowPublicAccess \
  --region us-east-1

# Add InvokeFunctionUrl permission with auth type condition
aws lambda add-permission \
  --function-name spotify-playlist-dev \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region us-east-1

# Add InvokeFunction permission
aws lambda add-permission \
  --function-name spotify-playlist-dev \
  --statement-id FunctionURLInvokeFunction \
  --action lambda:InvokeFunction \
  --principal "*" \
  --region us-east-1
```

## Verification

- Tested function URL accessibility: `HTTP 200` response confirmed
- Verified API endpoints: `/api/dashboard` endpoint working correctly
- Confirmed policy contains both required actions in separate statements

## Impact

- No breaking changes to existing functionality
- Function URL remains publicly accessible as intended
- Compliant with AWS's new security requirements
- No changes required to application code or deployment scripts

## References

- AWS Lambda Function URL Documentation: https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html
- AWS AddPermission API: https://docs.aws.amazon.com/lambda/latest/api/API_AddPermission.html
