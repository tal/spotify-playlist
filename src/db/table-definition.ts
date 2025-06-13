import * as fs from 'fs'
import { promisify } from 'util'
import { 
  CreateTableCommand,
  CreateTableCommandInput,
  ListTablesCommand,
  DeleteTableCommand,
  DescribeTableCommand
} from '@aws-sdk/client-dynamodb'
import { AWS } from '../aws'

const TABLE_DIR = __dirname + '/../../config/dynamo-tables/'

function getDataFromFile(path: string): Promise<CreateTableCommandInput> {
  return promisify(fs.readFile)(path, 'utf8').then((text) => {
    const data: CreateTableCommandInput = JSON.parse(text)
    return data
  })
}

function getTableDefinitions() {
  return new Promise<Promise<CreateTableCommandInput>[]>((succ, rej) => {
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
    tablesPromise = AWS.dynamo
      .send(new ListTablesCommand({}))
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

  for (let TableName of tables) {
    await AWS.dynamo.send(new DeleteTableCommand({ TableName }))
  }
}

export async function ensuareAllTablesCreated() {
  const tables = await TableDefinition.all()

  const promises = tables.map((table) => table.createIfNeeded())
  await Promise.all(promises)
}

export class TableDefinition {
  constructor(public params: CreateTableCommandInput) {}

  get name() {
    if (!this.params.TableName) {
      throw new Error('TableName is required')
    }
    return this.params.TableName
  }

  async createIfNeeded() {
    const alreadyCreated = await tableCreated(this.name)

    if (alreadyCreated) return

    return AWS.dynamo.send(new CreateTableCommand(this.params))
  }

  async delete() {
    return AWS.dynamo.send(new DeleteTableCommand({ TableName: this.name }))
  }

  async describe() {
    const resp = await AWS.dynamo.send(new DescribeTableCommand({ TableName: this.name }))
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
