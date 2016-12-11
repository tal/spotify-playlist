var Promise = require('bluebird')
var applescript = Promise.promisifyAll(require('applescript'))
var path = require('path')

function run(name) {
  var scriptPath = path.resolve(__dirname, '../scripts', name + '.scpt')

  return applescript.execFileAsync(scriptPath)
    .then(resp => JSON.parse(resp))
    .then(data => {
      if (data.error) {
        throw data.error
      } else {
        return data
      }
    })
}

module.exports = {
  run: run
}
