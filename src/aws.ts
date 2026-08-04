import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

class AWSInstanceManager {
  public dynamo: DynamoDBClient
  public docs: DynamoDBDocumentClient

  constructor(endpoint?: string) {
    // Create base DynamoDB client with v3 SDK
    // Build config object conditionally - only include credentials if explicitly provided
    // In Lambda, we MUST NOT pass explicit credentials - let the SDK use the execution role
    const config: any = {
      region: process.env.AWS_REGION || 'us-east-1',
    }

    // Only add endpoint for local development
    if (endpoint) {
      config.endpoint = endpoint

      // Only use explicit credentials for local DynamoDB (when endpoint is set)
      // Lambda execution role credentials are handled automatically by the SDK
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        config.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      }
    }
    // For Lambda (no endpoint), omit credentials entirely to use execution role

    const dynamoClient = new DynamoDBClient(config)

    this.dynamo = dynamoClient

    // Create document client from the base client
    // The marshallOptions and unmarshallOptions maintain compatibility with v2 behavior
    this.docs = DynamoDBDocumentClient.from(this.dynamo, {
      marshallOptions: {
        convertEmptyValues: false,
        removeUndefinedValues: true,
        convertClassInstanceToMap: false,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    })
  }
}

const instance = new AWSInstanceManager(
  (globalThis as any).dev?.isDev ? 'http://localhost:8000' : undefined,
)

export { instance as AWS }
