import importlib.util
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "identity", pathlib.Path(__file__).parents[1] / "ivx-native-handoff-identity.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeIdentityTests(unittest.TestCase):
    def parse(self, log):
        with tempfile.TemporaryDirectory() as directory:
            pathlib.Path(directory, "maestro.log").write_text(log)
            return module.read_identity(directory, "native-current")

    def test_reads_ui_value_and_ignores_stale_flow_and_command_source(self):
        self.assertEqual(self.parse(
            "JsConsole IVX_NATIVE_HANDOFF_JOB_ID=old NONCE=native-previous\n"
            "command IVX_NATIVE_HANDOFF_JOB_ID=source NONCE=native-current\n"
            "04:01 INFO JsConsole - IVX_NATIVE_HANDOFF_JOB_ID=job-123 NONCE=native-current\n"
        ), "job-123")

    def test_rejects_missing_current_ui_evidence(self):
        with self.assertRaises(ValueError):
            self.parse("JsConsole IVX_NATIVE_HANDOFF_JOB_ID=old NONCE=native-current-other\n")

    def test_rejects_conflicting_ui_identities(self):
        with self.assertRaises(ValueError):
            self.parse("\n".join(
                f"JsConsole IVX_NATIVE_HANDOFF_JOB_ID={job} NONCE=native-current"
                for job in ["job-1", "job-2"]
            ))


if __name__ == "__main__":
    unittest.main()
