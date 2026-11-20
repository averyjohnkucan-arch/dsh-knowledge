import {createHash,randomUUID} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {serialize,deserialize} from 'node:v8'
import type {ProcessingOutput} from './processing-types.js'

/** Disk-backed intermediate results: queues retain paths/IDs, not every PDF
 * and extracted document in RAM. No temporary checkpoint is a published KB
 * document. Cancellation must drain workers before close(). */
export class ImportCheckpoints {
  private closed=false
  private constructor(private readonly root:string) {}
  static async create(parent=tmpdir()):Promise<ImportCheckpoints> {
    return new ImportCheckpoints(await mkdtemp(join(parent,'dsh-import-stages-')))
  }
  private path(id:string,stage:'ocr'|'parsing'):string {
    if(this.closed)throw new Error('Import checkpoints closed')
    return join(this.root,`${createHash('sha256').update(id).digest('hex')}-${stage}.bin`)
  }
  async save(id:string,stage:'ocr'|'parsing',output:ProcessingOutput):Promise<void> {
    const target=this.path(id,stage),temporary=`${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary,serialize({version:1,id,stage,output}),{mode:0o600,flag:'wx'})
      await rename(temporary,target)
    }finally{await rm(temporary,{force:true})}
  }
  async load(id:string,stage:'ocr'|'parsing'):Promise<ProcessingOutput> {
    const checkpoint=deserialize(await readFile(this.path(id,stage)))
    if(checkpoint?.version!==1||checkpoint.id!==id||checkpoint.stage!==stage||typeof checkpoint.output?.document?.text!=='string')
      throw new Error('Invalid import checkpoint')
    return checkpoint.output
  }
  async remove(id:string,stage:'ocr'|'parsing'):Promise<void> {
    await rm(this.path(id,stage),{force:true})
  }
  async close():Promise<void> {
    if(this.closed)return
    this.closed=true
    await rm(this.root,{recursive:true,force:true})
  }
}
