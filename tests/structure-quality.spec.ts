import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
it('tolerates typography but rejects changed values, missing content and broken table relationships', () => {
  const result=execFileSync('python3',['-c',String.raw`
import sys
sys.path.insert(0,'scripts')
from structure_quality import compare,compare_block

def block(text,kind='text'):return {'page':1,'type':kind,'text':text}
assert compare_block(block('The long-term report,   dated 2025.'),block('The long—term report dated 2025'))['passed']
assert compare_block(block('Total: 1,234.50'),block('Total: 1234.50'))['passed']
assert not compare_block(block('Balance -5.2'),block('Balance 5.2'))['passed']
assert not compare_block(block('The contract remains valid.'),block('The contract remains invalid.'))['passed']
assert compare_block(block('One sentence.    Next sentence, here.'),block('One sentence   Next sentence here'))['passed']
assert not compare_block(block('Rate 0.001'),block('Rate 0.01'))['passed']
a=block('<table><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>20</td></tr></table>','table')
b=block('<table>\n<tr><td>A</td><td>10</td></tr>\n<tr><td>B</td><td>20</td></tr></table>','table')
assert compare_block(a,b)['passed']
assert not compare_block(a,block('<table><tr><td>B</td><td>10</td></tr><tr><td>A</td><td>20</td></tr></table>','table'))['passed']
b=block('<table><tr><td>A 10</td><td>B</td><td>20</td></tr></table>','table')
assert not compare_block(a,b)['passed']
assert not compare_block(block('A | 10\nB | 20','chart'),block('A | 20\nB | 10','chart'))['passed']
assert not compare({'pageCount':1,'blocks':[a]},{'pageCount':1,'blocks':[]})['passed']
print('ok')
`],{cwd:process.cwd(),encoding:'utf8'})
  expect(result.trim()).toBe('ok')
})
