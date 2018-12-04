import * as fs from 'fs'
import { CreateTableInput } from 'aws-sdk/clients/dynamodb'
import { AWS } from '../aws'

const TABLE_DIR = __dirname + '/../../config/dynamo-tables/'

function getDataFromFile(path: string): Promise<CreateTableInput> {
  return new Promise((succ, rej) => {
    fs.readFile(path, 'utf8', (err, json) => {
      if (err) {
        rej(err)
      } else {
        const data: CreateTableInput = JSON.parse(json)
        succ(data)
      }
    })
  })
}

function getTableDefinitions() {
  return new Promise<Promise<CreateTableInput>[]>((succ, rej) => {
    fs.readdir(TABLE_DIR, (err, items) => {
      if (err) {
        rej(err)
      } else {
        const promises = items
          .map(file => TABLE_DIR + file)
          .map(getDataFromFile)
        succ(promises)
      }
    })
  })
}

let tablesPromise: Promise<string[]> | undefined
function createdTables() {
  if (!tablesPromise) {
    tablesPromise = new Promise<string[]>((resolve, reject) => {
      AWS.dynamo.listTables((err, data) => {
        if (err) {
          reject(err)
          return
        }

        resolve(data.TableNames || [])
      })
    })
  }

  return tablesPromise
}

async function tableCreated(table: string) {
  const tables = await createdTables()

  return tables.includes(table)
}

export class TableDefinition {
  constructor(public params: CreateTableInput) {}

  get name() {
    return this.params.TableName
  }

  async createIfNeeded() {
    const alreadyCreated = tableCreated(this.name)

    if (alreadyCreated) return

    return AWS.dynamo.createTable(this.params).promise()
  }

  static async all() {
    const definitions = await getTableDefinitions()
    const tables: TableDefinition[] = []

    for (let definition of definitions) {
      tables.push(new TableDefinition(await definition))
    }

    return tables
  }
}
