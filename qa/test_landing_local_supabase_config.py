from pathlib import Path
import socket
import tempfile
import tomllib
import unittest

from landing_local_supabase_config import configure

CONFIG = '''project_id = "ivx-landing19-supabase"
[api]
enabled = true
port = 54321
schemas = ["public"]
[db]
port = 54322
shadow_port = 54320
major_version = 17
[auth]
enabled = true
site_url = "http://localhost:3000"
jwt_expiry = 3600
enable_refresh_token_rotation = true
[auth.email.smtp]
enabled = false
port = 2500
'''


class IsolatedConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'supabase' / 'config.toml'
        self.path.parent.mkdir()
        self.path.write_text(CONFIG)

    def test_occupied_database_port_is_reproduced_then_avoided(self):
        with socket.socket() as occupied:
            occupied.bind(('0.0.0.0', 0))
            port = occupied.getsockname()[1]
            self.path.write_text(CONFIG.replace('port = 54322', f'port = {port}'))
            with socket.socket() as baseline:
                with self.assertRaises(OSError):
                    baseline.bind(('0.0.0.0', port))
            result = configure(self.path, self.root, '34558545929', '1')
            values = [result[key] for key in ('apiPort', 'dbPort', 'shadowPort')]
            self.assertEqual(len(set(values)), 3)
            self.assertNotIn(port, values)
            # All replacement ports are actually bindable after configuration.
            sockets = [socket.socket() for _ in values]
            try:
                for handle, value in zip(sockets, values):
                    handle.bind(('0.0.0.0', value))
            finally:
                for handle in sockets:
                    handle.close()

    def test_auth_controls_and_unrelated_ports_are_preserved(self):
        configure(self.path, self.root, '123', '2')
        current = tomllib.loads(self.path.read_text())
        expected = tomllib.loads(CONFIG)
        expected['auth']['jwt_expiry'] = 60
        self.assertEqual(current['auth'], expected['auth'])
        self.assertEqual(current['api']['schemas'], ['public'])
        self.assertEqual(current['db']['major_version'], 17)

    def test_runs_have_separate_project_identities(self):
        first = configure(self.path, self.root, '123', '1')
        second = configure(self.path, self.root, '124', '1')
        self.assertNotEqual(first['projectId'], second['projectId'])

    def test_config_outside_runner_temp_is_rejected_unchanged(self):
        with self.assertRaises(ValueError):
            configure(self.path, self.root / 'other', '123', '1')
        self.assertEqual(self.path.read_text(), CONFIG)

    def test_unexpected_config_is_rejected_unchanged(self):
        source = CONFIG.replace('shadow_port = 54320\n', '')
        self.path.write_text(source)
        with self.assertRaises(ValueError):
            configure(self.path, self.root, '123', '1')
        self.assertEqual(self.path.read_text(), source)

    def test_invalid_run_identity_is_rejected_unchanged(self):
        with self.assertRaises(ValueError):
            configure(self.path, self.root, '../invalid', '1')
        self.assertEqual(self.path.read_text(), CONFIG)


if __name__ == '__main__':
    unittest.main()
