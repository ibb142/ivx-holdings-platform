import base64
import html
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import quote

from ivx_sanitize_qa_artifacts import REDACTED, UnsafeEvidence, sanitize


class ArtifactSanitizationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_maestro_environment_and_evaluated_input_are_scrubbed(self):
        secret = 'fake-ci-credential-123'
        data = [{'command': {'defineVariablesCommand': {'env': {'OWNER_PASSWORD': secret}}},
                 'metadata': {'evaluatedCommand': {'inputTextCommand': {'text': secret}}}}]
        path = self.root / 'commands.json'
        path.write_text(json.dumps(data))
        sanitize([self.root], {'OWNER_PASSWORD_EFFECTIVE': secret})
        result = json.loads(path.read_text())
        self.assertEqual(result[0]['command']['defineVariablesCommand']['env']['OWNER_PASSWORD'], REDACTED)
        self.assertEqual(result[0]['metadata']['evaluatedCommand']['inputTextCommand']['text'], REDACTED)

    def test_encoded_credentials_and_session_tokens_are_scrubbed(self):
        secret = 'fake<&"credential123'
        path = self.root / 'device-logcat.txt'
        representations = [secret, html.escape(secret), quote(secret, safe=''), base64.b64encode(secret.encode()).decode()]
        path.write_text('\n'.join(representations) + '\neyJfakepayload.eyJfakeclaims.fakeSignature')
        sanitize([self.root], {'OWNER_PASSWORD_S1': secret})
        self.assertFalse(any(value in path.read_text() for value in representations))
        self.assertNotIn('eyJfakepayload', path.read_text())

    def test_structured_secrets_are_removed_without_environment_and_proof_is_preserved(self):
        path = self.root / 'certificate.json'
        path.write_text(json.dumps({'passed': True, 'secretValuesReturned': False, 'sourceSha': 'a' * 40,
                                    'session': {'refresh_token': 'opaque-session-token', 'token': 'opaque-auth-token'}, 'coveragePercent': 100}))
        sanitize([self.root], {})
        data = json.loads(path.read_text())
        self.assertTrue(data['passed'])
        self.assertFalse(data['secretValuesReturned'])
        self.assertEqual(data['coveragePercent'], 100)
        self.assertEqual(data['sourceSha'], 'a' * 40)
        self.assertEqual(data['session']['refresh_token'], REDACTED)
        self.assertEqual(data['session']['token'], REDACTED)

    def test_binary_secret_blocks_publication(self):
        (self.root / 'frame.png').write_bytes(b'\x89PNG\xfffake-sensitive-value')
        with self.assertRaises(UnsafeEvidence):
            sanitize([self.root], {'OWNER_PASSWORD': 'fake-sensitive-value'})
        (self.root / 'frame.png').unlink()
        path = self.root / 'frame.gif'
        original = b'GIF89a fake-sensitive-value'
        path.write_bytes(original)
        with self.assertRaises(UnsafeEvidence):
            sanitize([self.root], {'OWNER_PASSWORD': 'fake-sensitive-value'})
        self.assertEqual(path.read_bytes(), original)

    def test_symlink_and_unknown_archive_block_publication(self):
        (self.root / 'untrusted.zip').write_bytes(b'PK\xff\x00')
        with self.assertRaises(UnsafeEvidence):
            sanitize([self.root], {})
        (self.root / 'untrusted.zip').unlink()
        (self.root / 'outside.txt').symlink_to(self.root.parent / 'outside')
        with self.assertRaises(UnsafeEvidence):
            sanitize([self.root], {})

    def test_missing_early_failure_artifacts_are_safe_and_short_credentials_fail_closed(self):
        self.assertEqual(sanitize([self.root / 'not-created'], {}), {'inspectedFiles': 0, 'sanitizedFiles': 0})
        with self.assertRaises(UnsafeEvidence):
            sanitize([self.root], {'OWNER_PASSWORD': 'abc'})


if __name__ == '__main__':
    unittest.main()
