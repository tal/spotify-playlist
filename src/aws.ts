import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

// Import X-Ray SDK if we're in Lambda environment
let AWSXRay: any
if (process.env._X_AMZN_TRACE_ID) {
  AWSXRay = require('aws-xray-sdk-core')
}

class AWSInstanceManager {
  public dynamo: DynamoDBClient
  public docs: DynamoDBDocumentClient

  constructor(endpoint?: string) {
    // Create base DynamoDB client with v3 SDK
    let dynamoClient = new DynamoDBClient({
      endpoint,
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      } : undefined,
    })

    // If X-Ray is enabled, capture the client
    if (AWSXRay && process.env._X_AMZN_TRACE_ID) {
      dynamoClient = AWSXRay.captureAWSv3Client(dynamoClient)
    }

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
  dev.isDev ? 'http://localhost:8000' : undefined,
)

export { instance as AWS }
