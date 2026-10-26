import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
it('restores CPU thread limits after chart errors and leaves CUDA untouched', () => {
  const result = execFileSync('python3', ['-c', String.raw`
import sys,types,contextlib
sys.path.insert(0,'scripts')
state={'threads':1,'entries':0}
@contextlib.contextmanager
def limits(limits,user_api):
 assert user_api=='openmp'
 previous=state['threads'];state['threads']=limits;state['entries']+=1
 try:yield
 finally:state['threads']=previous
sys.modules['threadpoolctl']=types.SimpleNamespace(threadpool_limits=limits)
from structure_cpu_threads import install_chart_threads
class Model:
 def process(self, fail=False):
  assert state['threads']==2
  if fail:raise RuntimeError('decoder failed')
  return {'value':'unchanged'}
m=Model();original=m.process
assert not install_chart_threads(m,'gpu:0',2)
assert not install_chart_threads(m,'cpu',0)
assert m.process==original
assert install_chart_threads(m,'cpu',2)
assert install_chart_threads(m,'cpu',2)
assert m.process()=={'value':'unchanged'}
assert state=={'threads':1,'entries':1}
try:m.process(fail=True)
except RuntimeError:pass
else:raise AssertionError('error was swallowed')
assert state=={'threads':1,'entries':2}
print('ok')
`], { encoding:'utf8' })
  expect(result.trim()).toBe('ok')
})
