const lambdaLocal = require('lambda-local');
const path = require('path')

var jsonPayload = {
    'key': 1,
    'another_key': "Some text"
}

async function main() {
  const done = await lambdaLocal.execute({
    event: jsonPayload,
    lambdaPath: path.join(__dirname, '../dist/index.js'),
    profilePath: '~/.aws/credentials',
    profileName: 'default',
    timeoutMs: 5000,
    verboseLevel: 3,
    envfile: path.join(__dirname, '../.env'),
    lambdaHandler: 'promote'
  })

  console.log(done)
}

main()
