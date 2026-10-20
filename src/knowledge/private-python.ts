import { access, chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { httpFetch } from './net.js'
export type PrivatePythonRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>
/** Bootstrap from Node itself: no system Python, shell installer or global package changes. */
export async function ensurePrivatePython(root: string, run: PrivatePythonRunner): Promise<string> {
  if (process.arch !== 'x64' || !['linux','win32'].includes(process.platform)) throw Error('Optional accelerator setup supports Linux and Windows x64')
  const python=join(root,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')
  try{await access(python);return python}catch{/* First installation. */}
  const uv=join(root,'bootstrap','uv-0.13.3.data','scripts',process.platform==='win32'?'uv.exe':'uv')
  try{await access(uv)}catch{
    const response=await httpFetch('https://pypi.org/pypi/uv/0.13.3/json',{signal:AbortSignal.timeout(60_000)})
    if(!response.ok)throw Error('Cannot retrieve the pinned Python bootstrap metadata')
    const data=await response.json() as {urls:Array<{filename:string;url:string;size:number;digests:{sha256:string}}>}
    const tag=process.platform==='win32'?'win_amd64':'manylinux_2_17_x86_64'
    const item=data.urls.find(f=>f.filename.endsWith('.whl')&&f.filename.includes(tag))
    if(!item||item.size>64*1024*1024||!/^https:\/\/files\.pythonhosted\.org\//.test(item.url))throw Error('Unsupported Python bootstrap wheel')
    const download=await httpFetch(item.url,{signal:AbortSignal.timeout(180_000)})
    if(!download.ok)throw Error('Python bootstrap download failed')
    const bytes=Buffer.from(await download.arrayBuffer())
    if(bytes.length!==item.size||createHash('sha256').update(bytes).digest('hex')!==item.digests.sha256)throw Error('Python bootstrap checksum mismatch')
    const zip=await JSZip.loadAsync(bytes),entry=zip.file(`uv-0.13.3.data/scripts/${process.platform==='win32'?'uv.exe':'uv'}`)
    if(!entry)throw Error('Python bootstrap binary missing from verified wheel')
    await mkdir(dirname(uv),{recursive:true});await writeFile(uv+'.part',await entry.async('nodebuffer'));await chmod(uv+'.part',0o755);await rename(uv+'.part',uv)
  }
  const env={...process.env,UV_PYTHON_INSTALL_DIR:join(root,'python'),UV_CACHE_DIR:join(root,'uv-cache'),CUDA_VISIBLE_DEVICES:'',HIP_VISIBLE_DEVICES:'',ROCR_VISIBLE_DEVICES:''}
  await run(uv,['python','install','3.12.15','--no-bin'],env)
  await run(uv,['venv','--python','3.12.15',join(root,'venv')],env)
  await access(python);return python
}
