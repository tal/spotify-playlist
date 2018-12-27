import AWS from 'aws-sdk'
import { getEnv } from './env'

const env = getEnv().then(env => {
  AWS.config.update(env.aws)
})

class AWSInstanceManager {
  constructor(private endpoint: string) {}

  private _dynamo?: Promise<AWS.DynamoDB>
  get dynamo() {
    if (!this._dynamo) {
      this._dynamo = env.then(
        () =>
          new AWS.DynamoDB({
            endpoint: this.endpoint,
          }),
      )
    }

    return this._dynamo
  }

  private _docs?: Promise<AWS.DynamoDB.DocumentClient>
  get docs() {
    if (!this._docs) {
      this._docs = env.then(
        () =>
          new AWS.DynamoDB.DocumentClient({
            endpoint: this.endpoint,
          }),
      )
    }

    return this._docs
  }
}

const instance = new AWSInstanceManager('http://localhost:8000')

export { instance as AWS }
