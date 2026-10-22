import importlib.util, types, unittest
from pathlib import Path
path=Path(__file__).resolve().parents[1] / 'scripts' / 'structure-v3.py'
spec=importlib.util.spec_from_file_location('structure',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Detector:
 def __init__(self,confirmed=True):
  self.runner='accelerated';self._dsh_reference_runner='reference';self.calls=[];self.confirmed=confirmed
 def __call__(self,input,**kwargs):
  self.calls.append((self.runner,kwargs));labels=['table'] if self.runner=='accelerated' or self.confirmed else []
  yield {'boxes':[{'label':x} for x in labels],'input_img':'pixels'}
class Screening(unittest.TestCase):
 def setup_detector(self,confirmed=True):
  d=Detector(confirmed);m.pipeline=lambda charts:types.SimpleNamespace(paddlex_pipeline=types.SimpleNamespace(layout_det_model=d));return d
 def test_screening_defers_without_cpu_confirmation(self):
  d=self.setup_detector();out=m.extract(['pixels'],True,True,True)
  self.assertEqual(out['deferredPages'],[0]);self.assertEqual(out['blocks'],[]);self.assertEqual(d.calls,[('accelerated',{'threshold':.25})])
 def test_final_layout_still_uses_reference(self):
  d=self.setup_detector();rows=list(m.structure_inputs(['pixels'],True,True));self.assertTrue(rows[0][2]);self.assertEqual([x[0] for x in d.calls],['accelerated','reference']);self.assertEqual(d.runner,'accelerated')
 def test_false_positive_is_filtered_at_interpretation(self):
  d=self.setup_detector(False);self.assertEqual(m.extract(['pixels'],True,True,True)['deferredPages'],[0]);out=m.extract(['pixels'],True,True,False);self.assertEqual(out['blocks'],[]);self.assertEqual([x[0] for x in d.calls],['accelerated','accelerated','reference'])
if __name__=='__main__':unittest.main()
