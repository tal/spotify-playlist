import AWS from 'aws-sdk'
import { memoize } from 'decko'

AWS.config.update({
  region: 'us-west-2',
  accessKeyId: 'fakeMyKeyId',
  secretAccessKey: 'fakeSecretAccessKey',
})

class AWSInstanceManager {
  constructor(private endpoint: string) {}

  @memoize
  get dynamo() {
    return new AWS.DynamoDB({
      endpoint: this.endpoint,
    })
  }

  @memoize
  get docs() {
    return new AWS.DynamoDB.DocumentClient({
      endpoint: this.endpoint,
    })
  }
}

const instance = new AWSInstanceManager('http://localhost:8000')

export { instance as AWS }
