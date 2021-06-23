import * as fs from 'fs'
import { promisify } from 'util'
import { CreateTableInput } from 'aws-sdk/clients/dynamodb'
import { AWS } from '../aws'

const TABLE_DIR = __dirname + '/../../config/dynamo-tables/'

function getDataFromFile(path: string): Promise<CreateTableInput> {
  return promisify(fs.readFile)(path, 'utf8').then((text) => {
    const data: CreateTableInput = JSON.parse(text)
    return data
  })
}

function getTableDefinitions() {
  return new Promise<Promise<CreateTableInput>[]>((succ, rej) => {
    fs.readdir(TABLE_DIR, (err, items) => {
      if (err) {
        rej(err)
      } else {
        const promises = items
          .map((file) => TABLE_DIR + file)
          .map(getDataFromFile)
        succ(promises)
      }
    })
  })
}

let tablesPromise: Promise<string[]> | undefined
async function createdTables() {
  if (!tablesPromise) {
    const dynamo = await AWS.dynamo

    tablesPromise = dynamo
      .listTables()
      .promise()
      .then((data) => data.TableNames)
      .then((names) => {
        if (!names) throw 'no tables found'
        return names
      })
  }

  return await tablesPromise
}

async function tableCreated(table: string) {
  const tables = await createdTables()

  return tables.includes(table)
}

export async function deleteAllTables() {
  const tables = await createdTables()
  const dynamo = await AWS.dynamo

  for (let TableName of tables) {
    await dynamo.deleteTable({ TableName }).promise()
  }
}

export async function ensuareAllTablesCreated() {
  const tables = await TableDefinition.all()

  const promises = tables.map((table) => table.createIfNeeded())
  await Promise.all(promises)
}

export class TableDefinition {
  constructor(public params: CreateTableInput) {}

  get name() {
    return this.params.TableName
  }

  async createIfNeeded() {
    const alreadyCreated = await tableCreated(this.name)

    if (alreadyCreated) return

    const dynamo = await AWS.dynamo

    return dynamo.createTable(this.params).promise()
  }

  async delete() {
    const dynamo = await AWS.dynamo
    return dynamo.deleteTable({ TableName: this.name }).promise()
  }

  async describe() {
    const dynamo = await AWS.dynamo

    const resp = await dynamo.describeTable({ TableName: this.name }).promise()
    return resp.Table
  }

  static async createIfNeeded() {
    const all = await this.all()

    for (let table of all) {
      await table.createIfNeeded()
    }
  }

  static async deleteAll() {
    const all = await this.all()

    for (let table of all) {
      await table.createIfNeeded()
    }
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
