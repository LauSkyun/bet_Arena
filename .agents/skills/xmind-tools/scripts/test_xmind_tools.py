import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

def _write_xmind(path, content):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("content.json", json.dumps(content, ensure_ascii=False))
        zf.writestr("metadata.json", json.dumps({"creator": {"name": "test"}}))
        zf.writestr("manifest.json", json.dumps({"file-entries": {"content.json": {}}}))
        zf.writestr("Thumbnails/", "")
        zf.writestr("Thumbnails/thumbnail.png", b"png")


def _read_content(path):
    with zipfile.ZipFile(path) as zf:
        return json.loads(zf.read("content.json"))


class XMindToolTests(unittest.TestCase):
    def test_list_topics_json_includes_markers_paths_and_plain_notes(self):
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "marked.xmind"
            _write_xmind(source, [{
                "id": "sheet-1", "title": "Cases", "rootTopic": {
                    "id": "root", "title": "Root", "children": {"attached": [{
                        "id": "case-1", "title": "A/B", "markers": [{"markerId": "flag-green"}],
                        "notes": {"plain": {"content": "Checked\nwith evidence"}},
                    }]},
                },
            }, {"id": "sheet-2", "title": "Other", "rootTopic": {"id": "other", "title": "Other"}}])
            command = [sys.executable, str(SCRIPTS / "xmind_edit.py"), "--source",
                       str(source), "list-topics", "--sheet", "Cases"]
            result = subprocess.run([*command, "--json"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = json.loads(result.stdout)
            self.assertEqual(rows[1], {
                "sheet": "Cases", "topic_id": "case-1", "path": ["Root", "A/B"],
                "title": "A/B", "markers": ["flag-green"], "notes": "Checked\nwith evidence",
            })
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["markers"], [])
            self.assertNotIn("notes", rows[0])
            text = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertEqual(text.stdout, "Cases\troot\tRoot\nCases\tcase-1\tRoot/A/B\n")

    def test_parse_outline_accepts_tabs_and_spaces(self):
        from xmind_edit import parse_outline

        root = parse_outline(
            "#14777\n"
            "    挑战券\n"
            "        初始数量\n"
            "\t\t恢复规则\n"
            "    圣裁\n"
        )

        self.assertEqual(root["title"], "#14777")
        self.assertEqual([child["title"] for child in root["children"]], ["挑战券", "圣裁"])
        self.assertEqual(
            [child["title"] for child in root["children"][0]["children"]],
            ["初始数量", "恢复规则"],
        )

    def test_replace_sheet_preserves_other_sheets_and_archive_entries(self):
        from xmind_edit import XMindEditor

        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            source = tmp_path / "source.xmind"
            output = tmp_path / "output.xmind"
            _write_xmind(
                source,
                [
                    {"id": "sheet-a", "title": "旧画布", "rootTopic": {"id": "root-a", "title": "旧画布"}},
                    {"id": "sheet-b", "title": "#14777", "rootTopic": {"id": "root-b", "title": "旧#14777"}},
                ],
            )

            editor = XMindEditor.load(source)
            editor.replace_sheet_from_outline("#14777\n\t挑战券\n\t\t恢复规则", sheet_title="#14777")
            editor.save(output)

            content = _read_content(output)
            self.assertEqual([sheet["title"] for sheet in content], ["旧画布", "#14777"])
            self.assertEqual(content[0]["id"], "sheet-a")
            self.assertEqual(content[1]["rootTopic"]["title"], "#14777")
            self.assertEqual(content[1]["rootTopic"]["children"]["attached"][0]["title"], "挑战券")
            with zipfile.ZipFile(output) as zf:
                self.assertIn("Thumbnails/thumbnail.png", zf.namelist())

    def test_node_level_add_update_move_delete(self):
        from xmind_edit import XMindEditor

        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            source = tmp_path / "source.xmind"
            output = tmp_path / "output.xmind"
            _write_xmind(
                source,
                [
                    {
                        "id": "sheet-1",
                        "title": "#14777",
                        "rootTopic": {
                            "id": "root",
                            "title": "#14777",
                            "children": {
                                "attached": [
                                    {"id": "tickets", "title": "挑战券"},
                                    {"id": "battle", "title": "战斗"},
                                ]
                            },
                        },
                    }
                ],
            )

            editor = XMindEditor.load(source)
            added_id = editor.add_child("tickets", "恢复规则")
            editor.update_title(added_id, "恢复规则-30分钟")
            editor.move_topic(added_id, "battle", index=0)
            editor.delete_topic("tickets")
            editor.save(output)

            root_children = _read_content(output)[0]["rootTopic"]["children"]["attached"]
            self.assertEqual([child["title"] for child in root_children], ["战斗"])
            battle_children = root_children[0]["children"]["attached"]
            self.assertEqual(battle_children[0]["id"], added_id)
            self.assertEqual(battle_children[0]["title"], "恢复规则-30分钟")

    def test_marker_and_legend_writes(self):
        from xmind_edit import XMindEditor

        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            source = tmp_path / "source.xmind"
            output = tmp_path / "output.xmind"
            _write_xmind(
                source,
                [
                    {
                        "id": "sheet-1",
                        "title": "画布 1",
                        "rootTopic": {
                            "id": "root",
                            "title": "中心主题",
                            "children": {"attached": [{"id": "case", "title": "图例说明"}]},
                        },
                    }
                ],
            )

            editor = XMindEditor.load(source)
            editor.set_markers("case", ["flag-green", "people-blue"])
            editor.set_markers("case", ["flag-green", "star-green"], append=True)
            editor.set_legend(
                "画布 1",
                [
                    ("flag-green", "白盒已确认"),
                    ("people-blue", "人工测试"),
                    ("star-green", "协议覆盖"),
                ],
                visibility="visible",
                x=-232.440673828125,
                y=-238.9000244140625,
            )
            editor.save(output)

            sheet = _read_content(output)[0]
            topic = sheet["rootTopic"]["children"]["attached"][0]
            self.assertEqual(
                topic["markers"],
                [{"markerId": "flag-green"}, {"markerId": "people-blue"}, {"markerId": "star-green"}],
            )
            self.assertEqual(sheet["legend"]["visibility"], "visible")
            self.assertEqual(sheet["legend"]["position"]["x"], -232.440673828125)
            self.assertEqual(sheet["legend"]["markers"]["flag-green"]["name"], "白盒已确认")
            self.assertEqual(sheet["legend"]["markers"]["people-blue"]["name"], "人工测试")
            self.assertEqual(sheet["legend"]["markers"]["star-green"]["name"], "协议覆盖")

    def test_official_generator_creates_xmind_from_outline(self):
        with tempfile.TemporaryDirectory() as td:
            tmp_path = Path(td)
            outline = tmp_path / "case.txt"
            output = tmp_path / "new.xmind"
            outline.write_text("#14777\n\t挑战券\n\t\t恢复规则\n", encoding="utf-8")

            subprocess.run(
                ["node", str(SCRIPTS / "xmind_new.mjs"), "--input", str(outline), "--output", str(output)],
                check=True,
                cwd=SCRIPTS,
            )

            content = _read_content(output)
            self.assertEqual(content[0]["title"], "#14777")
            self.assertEqual(content[0]["rootTopic"]["title"], "#14777")
            self.assertEqual(content[0]["rootTopic"]["children"]["attached"][0]["title"], "挑战券")


if __name__ == "__main__":
    unittest.main()
