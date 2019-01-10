import AWS from 'aws-sdk'

class AWSInstanceManager {
  public dynamo: AWS.DynamoDB
  public docs: AWS.DynamoDB.DocumentClient

  constructor(endpoint?: string) {
    this.dynamo = new AWS.DynamoDB({
      endpoint,
    })

    this.docs = new AWS.DynamoDB.DocumentClient({
      endpoint,
    })
  }
}

const instance = new AWSInstanceManager(
  dev.isDev ? 'http://localhost:8000' : undefined,
)

export { instance as AWS }
