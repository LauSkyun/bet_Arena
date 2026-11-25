import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent

def _write_xmind(path, content):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("content.json", json.dumps(content))


class XMindConverterTests(unittest.TestCase):
    def test_converter_reads_json_and_legacy_xml_from_this_skill(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            modern = root / 'modern.xmind'
            _write_xmind(modern, [
                {'title': 'Cases', 'rootTopic': {'title': 'Root', 'children': {'attached': [{'title': 'Case A'}]}}},
                {'title': 'Other', 'rootTopic': {'title': 'Unselected'}},
            ])
            legacy = root / 'legacy.xmind'
            with zipfile.ZipFile(legacy, 'w') as archive:
                archive.writestr('content.xml', '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">'
                                 '<sheet><title>Cases</title><topic><title>Root</title><children>'
                                 '<topics type="attached"><topic><title>Case A</title></topic></topics>'
                                 '</children></topic></sheet></xmap-content>')
            for source in (modern, legacy):
                command = [sys.executable, str(SCRIPTS / 'xmind2md.py'), str(source), '--sheet', 'Cases']
                result = subprocess.run([*command, '--stdout'], capture_output=True, text=True, check=True)
                self.assertIn('# Root', result.stdout)
                self.assertIn('## Case A', result.stdout)
                self.assertNotIn('Unselected', result.stdout)
                output = root / (source.stem + '.md')
                subprocess.run([*command, '--out-file', str(output)], capture_output=True, text=True, check=True)
                self.assertIn('## Case A', output.read_text())
