import { TableDefinition } from './db/table-definition'

TableDefinition.all().then(stuff => stuff.forEach(def => def.createIfNeeded()))
