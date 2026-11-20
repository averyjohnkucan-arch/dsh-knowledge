import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
it('assembles OCR boxes into readable lines while preserving column and CJK boundaries',()=>{
 const output=execFileSync('python3',['-c',`
import sys
sys.path.insert(0,'scripts')
from ocr_text_layout import assemble_ocr_text
box=lambda x,y,w:[[x,y],[x+w,y],[x+w,y+10],[x,y+10]]
assert assemble_ocr_text(['The','telemetry','system'],[box(0,0,20),box(25,.3,45),box(75,0,30)])=='The telemetry system'
assert assemble_ocr_text(['left','right'],[box(0,0,20),box(200,0,20)])=='left\\nright'
assert assemble_ocr_text(['中','文'],[box(0,0,10),box(10,0,10)])=='中文'
assert assemble_ocr_text(['first','second'],[box(0,0,20),box(0,20,20)])=='first\\nsecond'
assert assemble_ocr_text(['first','second'],None)=='first\\nsecond'
assert assemble_ocr_text([],[])==''
print('ok')
`],{encoding:'utf8'})
 expect(output.trim()).toBe('ok')
})
