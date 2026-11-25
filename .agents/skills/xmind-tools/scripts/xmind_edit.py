#!/usr/bin/env python3
import argparse
import json
import shutil
import sys
import uuid
import zipfile
from pathlib import Path


def _line_info(raw_line):
    line = raw_line.rstrip("\r")
    if not line.strip():
        return None
    leading_len = len(line) - len(line.lstrip(" \t"))
    leading = line[:leading_len]
    title = line[leading_len:].strip()
    if not title:
        return None
    level = 0.0
    for ch in leading:
        level += 1 if ch == "\t" else 0.25
    return int(level), title


def parse_outline(text):
    root = {"title": None, "children": []}
    stack = [(-1, root)]
    for raw_line in text.splitlines():
        info = _line_info(raw_line)
        if info is None:
            continue
        level, title = info
        node = {"title": title, "children": []}
        while len(stack) > 1 and stack[-1][0] >= level:
            stack.pop()
        stack[-1][1]["children"].append(node)
        stack.append((level, node))
    if len(root["children"]) != 1:
        raise ValueError("Outline must contain exactly one root topic")
    return root["children"][0]


def _new_id():
    return str(uuid.uuid4())


def _topic_from_outline(node):
    topic = {"id": _new_id(), "class": "topic", "title": node["title"]}
    children = [_topic_from_outline(child) for child in node.get("children", [])]
    if children:
        topic["children"] = {"attached": children}
    return topic


def _new_topic(title):
    return {"id": _new_id(), "title": title}


def _marker_spec(value):
    marker_id, sep, name = value.partition("=")
    marker_id = marker_id.strip()
    if not marker_id:
        raise argparse.ArgumentTypeError("marker spec must start with a marker id")
    if not sep:
        raise argparse.ArgumentTypeError("marker spec must use marker-id=name")
    name = name.strip()
    if not name:
        raise argparse.ArgumentTypeError("marker spec name cannot be empty")
    return marker_id, name


class XMindEditor:
    def __init__(self, source_path, entries, content):
        self.source_path = Path(source_path)
        self.entries = entries
        self.content = content

    @classmethod
    def load(cls, path):
        source_path = Path(path)
        entries = {}
        with zipfile.ZipFile(source_path, "r") as zf:
            for info in zf.infolist():
                entries[info.filename] = zf.read(info.filename)
        if "content.json" not in entries:
            raise ValueError("XMind file does not contain content.json")
        content = json.loads(entries["content.json"].decode("utf-8"))
        if not isinstance(content, list):
            raise ValueError("content.json must contain a sheet list")
        return cls(source_path, entries, content)

    def save(self, path):
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        new_entries = dict(self.entries)
        new_entries["content.json"] = json.dumps(self.content, ensure_ascii=False, indent=2).encode("utf-8")
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for name, data in new_entries.items():
                zf.writestr(name, data)

    def replace_sheet_from_outline(self, outline, sheet_title=None):
        root = parse_outline(outline)
        title = sheet_title or root["title"]
        root_topic = _topic_from_outline(root)
        root_topic["structureClass"] = "org.xmind.ui.logic.right"
        for idx, sheet in enumerate(self.content):
            if sheet.get("title") == title:
                new_sheet = dict(sheet)
                new_sheet["title"] = title
                new_sheet["rootTopic"] = root_topic
                self.content[idx] = new_sheet
                return
        self.content.append({
            "id": _new_id(),
            "class": "sheet",
            "title": title,
            "rootTopic": root_topic,
        })

    def iter_topics(self):
        for sheet in self.content:
            root = sheet.get("rootTopic")
            if root:
                yield from self._iter_topic_tree(sheet, root, [], None)

    def _iter_topic_tree(self, sheet, topic, path, parent_info):
        title = topic.get("title", "")
        next_path = path + [title]
        yield {
            "sheet": sheet,
            "topic": topic,
            "path": next_path,
            "parent_info": parent_info,
        }
        for child_type, children in (topic.get("children") or {}).items():
            if not isinstance(children, list):
                continue
            for idx, child in enumerate(children):
                yield from self._iter_topic_tree(
                    sheet,
                    child,
                    next_path,
                    {"parent": topic, "child_type": child_type, "children": children, "index": idx},
                )

    def topic_record(self, topic_id):
        for record in self.iter_topics():
            if record["topic"].get("id") == topic_id:
                return record
        raise KeyError(f"Topic id not found: {topic_id}")

    def sheet_record(self, sheet_title):
        for sheet in self.content:
            if sheet.get("title") == sheet_title:
                return sheet
        raise KeyError(f"Sheet title not found: {sheet_title}")

    def add_child(self, parent_id, title, index=None):
        parent = self.topic_record(parent_id)["topic"]
        children_obj = parent.setdefault("children", {})
        attached = children_obj.setdefault("attached", [])
        topic = _new_topic(title)
        if index is None or index >= len(attached):
            attached.append(topic)
        else:
            attached.insert(max(index, 0), topic)
        return topic["id"]

    def add_subtree(self, parent_id, outline, index=None):
        root = parse_outline(outline)
        parent = self.topic_record(parent_id)["topic"]
        children_obj = parent.setdefault("children", {})
        attached = children_obj.setdefault("attached", [])
        topic = _topic_from_outline(root)
        if index is None or index >= len(attached):
            attached.append(topic)
        else:
            attached.insert(max(index, 0), topic)
        return topic["id"]

    def update_title(self, topic_id, title):
        self.topic_record(topic_id)["topic"]["title"] = title

    def set_markers(self, topic_id, marker_ids, append=False):
        topic = self.topic_record(topic_id)["topic"]
        marker_items = [{"markerId": marker_id} for marker_id in marker_ids]
        if append:
            existing = topic.setdefault("markers", [])
            seen = {item.get("markerId") for item in existing}
            for item in marker_items:
                if item["markerId"] not in seen:
                    existing.append(item)
                    seen.add(item["markerId"])
        elif marker_items:
            topic["markers"] = marker_items
        else:
            topic.pop("markers", None)

    def clear_markers(self, topic_id, marker_ids=None):
        topic = self.topic_record(topic_id)["topic"]
        if not marker_ids:
            topic.pop("markers", None)
            return
        marker_id_set = set(marker_ids)
        remaining = [item for item in topic.get("markers", []) if item.get("markerId") not in marker_id_set]
        if remaining:
            topic["markers"] = remaining
        else:
            topic.pop("markers", None)

    def set_legend(self, sheet_title, marker_specs, visibility=None, x=None, y=None, replace=False):
        sheet = self.sheet_record(sheet_title)
        legend = sheet.setdefault("legend", {})
        if visibility is not None:
            legend["visibility"] = visibility
        if x is not None or y is not None:
            position = legend.setdefault("position", {})
            if x is not None:
                position["x"] = x
            if y is not None:
                position["y"] = y
        if marker_specs:
            markers = {} if replace else dict(legend.get("markers") or {})
            for marker_id, name in marker_specs:
                markers[marker_id] = {"name": name}
            legend["markers"] = markers

    def delete_topic(self, topic_id):
        record = self.topic_record(topic_id)
        parent_info = record["parent_info"]
        if parent_info is None:
            raise ValueError("Cannot delete a root topic")
        del parent_info["children"][parent_info["index"]]

    def move_topic(self, topic_id, new_parent_id, index=None):
        record = self.topic_record(topic_id)
        topic = record["topic"]
        parent_info = record["parent_info"]
        if parent_info is None:
            raise ValueError("Cannot move a root topic")
        new_parent = self.topic_record(new_parent_id)["topic"]
        if self._is_descendant(topic, new_parent_id):
            raise ValueError("Cannot move a topic under its own descendant")
        del parent_info["children"][parent_info["index"]]
        attached = new_parent.setdefault("children", {}).setdefault("attached", [])
        if index is None or index >= len(attached):
            attached.append(topic)
        else:
            attached.insert(max(index, 0), topic)

    def _is_descendant(self, topic, topic_id):
        for child in (topic.get("children") or {}).get("attached", []):
            if child.get("id") == topic_id or self._is_descendant(child, topic_id):
                return True
        return False

    def list_sheets(self):
        return [(idx, sheet.get("id", ""), sheet.get("title", "")) for idx, sheet in enumerate(self.content)]

    def list_topics(self, sheet_title=None, json_output=False):
        rows = []
        for record in self.iter_topics():
            sheet = record["sheet"]
            if sheet_title and sheet.get("title") != sheet_title:
                continue
            topic = record["topic"]
            if json_output:
                row = {
                    "sheet": sheet.get("title", ""), "topic_id": topic.get("id", ""),
                    "path": record["path"], "title": topic.get("title", ""),
                    "markers": [item["markerId"] for item in topic.get("markers", [])],
                }
                notes = topic.get("notes", {}).get("plain", {}).get("content")
                if notes:
                    row["notes"] = notes
                rows.append(row)
            else:
                rows.append((sheet.get("title", ""), topic.get("id", ""), "/".join(record["path"])))
        return rows


def _write_result(editor, args):
    if args.in_place:
        backup = Path(str(args.source) + ".bak")
        shutil.copy2(args.source, backup)
        editor.save(args.source)
        print(f"updated: {args.source}")
        print(f"backup: {backup}")
    else:
        if not args.output:
            raise SystemExit("--output is required unless --in-place is set")
        editor.save(args.output)
        print(f"written: {args.output}")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Edit modern content.json based XMind files.")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--in-place", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list-sheets")
    p = sub.add_parser("list-topics")
    p.add_argument("--sheet")
    p.add_argument("--json", action="store_true", help="Include paths, markers and plain notes as JSON")

    p = sub.add_parser("replace-sheet")
    p.add_argument("--sheet", required=True)
    p.add_argument("--input", required=True, type=Path)

    p = sub.add_parser("add-child")
    p.add_argument("--parent-id", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--index", type=int)

    p = sub.add_parser("add-subtree")
    p.add_argument("--parent-id", required=True)
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--index", type=int)

    p = sub.add_parser("update-title")
    p.add_argument("--topic-id", required=True)
    p.add_argument("--title", required=True)

    p = sub.add_parser("set-marker")
    p.add_argument("--topic-id", required=True)
    p.add_argument("--marker-id", required=True, action="append")
    p.add_argument("--append", action="store_true")

    p = sub.add_parser("clear-marker")
    p.add_argument("--topic-id", required=True)
    p.add_argument("--marker-id", action="append")

    p = sub.add_parser("set-legend")
    p.add_argument("--sheet", required=True)
    p.add_argument("--marker", type=_marker_spec, action="append", default=[])
    p.add_argument("--replace", action="store_true")
    p.add_argument("--visibility", choices=["visible", "hidden", ""], default=None)
    p.add_argument("--x", type=float)
    p.add_argument("--y", type=float)

    p = sub.add_parser("delete-topic")
    p.add_argument("--topic-id", required=True)

    p = sub.add_parser("move-topic")
    p.add_argument("--topic-id", required=True)
    p.add_argument("--new-parent-id", required=True)
    p.add_argument("--index", type=int)

    args = parser.parse_args(argv)
    editor = XMindEditor.load(args.source)

    if args.cmd == "list-sheets":
        for idx, sheet_id, title in editor.list_sheets():
            print(f"{idx}\t{sheet_id}\t{title}")
        return 0
    if args.cmd == "list-topics":
        if args.json:
            print(json.dumps(editor.list_topics(args.sheet, json_output=True), ensure_ascii=False, indent=2))
        else:
            for sheet, topic_id, path in editor.list_topics(args.sheet):
                print(f"{sheet}\t{topic_id}\t{path}")
        return 0
    if args.cmd == "replace-sheet":
        editor.replace_sheet_from_outline(args.input.read_text(encoding="utf-8"), args.sheet)
    elif args.cmd == "add-child":
        topic_id = editor.add_child(args.parent_id, args.title, args.index)
        print(f"added: {topic_id}")
    elif args.cmd == "add-subtree":
        topic_id = editor.add_subtree(args.parent_id, args.input.read_text(encoding="utf-8"), args.index)
        print(f"added: {topic_id}")
    elif args.cmd == "update-title":
        editor.update_title(args.topic_id, args.title)
    elif args.cmd == "set-marker":
        editor.set_markers(args.topic_id, args.marker_id, args.append)
    elif args.cmd == "clear-marker":
        editor.clear_markers(args.topic_id, args.marker_id)
    elif args.cmd == "set-legend":
        editor.set_legend(args.sheet, args.marker, args.visibility, args.x, args.y, args.replace)
    elif args.cmd == "delete-topic":
        editor.delete_topic(args.topic_id)
    elif args.cmd == "move-topic":
        editor.move_topic(args.topic_id, args.new_parent_id, args.index)
    _write_result(editor, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
