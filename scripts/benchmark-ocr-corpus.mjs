/** Read-only corpus replay. Pause the live OCR queue before benchmarking. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const target = fileURLToPath(new URL('../lib/knowledge/benchmark-ocr.mjs', import.meta.url))
if (process.argv.length < 4) { console.error('Usage: npm run benchmark:ocr -- <PDF corpus directory> <output JSON> [document concurrency=8] [limit=0]'); process.exit(2) }
const child=spawn(process.execPath,[target,...process.argv.slice(2)],{stdio:'inherit'})
process.once('SIGINT',()=>child.kill('SIGINT'))
child.once('error',error=>{console.error(error.message);process.exitCode=1})
child.once('exit',code=>{process.exitCode=code??1})
