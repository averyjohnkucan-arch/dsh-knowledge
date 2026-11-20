import { parentPort } from 'node:worker_threads'
parentPort.on('message', ({id,data}) => {
  const text = Buffer.from(data).toString()
  if (text === 'crash') { setTimeout(() => process.exit(7), 20); return }
  if (text === 'hang') return
  setTimeout(() => parentPort.postMessage({id,ok:true,text}), text === 'slow' ? 100 : 0)
})
