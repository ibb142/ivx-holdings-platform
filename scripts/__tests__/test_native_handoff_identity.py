import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('identity', pathlib.Path(__file__).parents[1] / 'ivx-native-handoff-identity.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
JOB = 'ivx-worker-7d18c8ad-aaca-4e1e-95d1-d319709a32e4'

def record(text, nonce='native-current'):
    return '04:01 INFO JsConsole - IVX_NATIVE_HANDOFF_UI=' + json.dumps({'text': text, 'nonce': nonce}) + '\n'

class NativeIdentityTests(unittest.TestCase):
    def parse(self, log):
        with tempfile.TemporaryDirectory() as directory:
            debug = pathlib.Path(directory, 'debug')
            debug.mkdir()
            (debug / 'maestro.log').write_text(log)
            return module.read_identity(debug, 'native-current')

    def test_preserves_complete_ui_uuid_across_visual_line_breaks(self):
        self.assertEqual(self.parse(record('JOB_ID: ' + JOB.replace('worker-', 'worker-\n'))), JOB)

    def test_ignores_stale_flow_and_command_source(self):
        self.assertEqual(self.parse(record('JOB_ID: ivx-worker', 'old') + 'command IVX_NATIVE_HANDOFF_UI={}\n' + record('JOB_ID: '+JOB)), JOB)

    def test_rejects_truncated_identity(self):
        with self.assertRaises(ValueError): self.parse(record('JOB_ID: ivx-worker'))

    def test_rejects_conflicting_ui_identities(self):
        with self.assertRaises(ValueError): self.parse(record('JOB_ID: '+JOB) + record('JOB_ID: '+JOB.replace('7d18c8ad','8d18c8ad')))

if __name__ == '__main__': unittest.main()
