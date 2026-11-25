---
name: xmind-tools
description: Read or convert XMind .xmind files to Markdown, create mind maps from outlines, edit existing sheets and topics, or validate written XMind output.
---

# XMind Tools

Use this skill to read, convert and edit `.xmind` files locally. Default to writing a copy first; only overwrite the source when the user explicitly wants direct sync or the workflow requires it.

## Scripts

- `$XMIND_TOOLS_SKILL/scripts/xmind_new.mjs`: create a new `.xmind` from an indented outline using the official `xmind-generator` package.
- `$XMIND_TOOLS_SKILL/scripts/xmind_edit.py`: edit modern `.xmind` files that contain `content.json`.
- `$XMIND_TOOLS_SKILL/scripts/xmind2md.py`: read sheets and convert modern JSON or legacy XML XMind archives to Markdown.

Set paths once:

```bash
# Resolve this skill directory in the current installation, then use its bundled scripts.
export XMIND_TOOLS_SKILL="/absolute/path/to/xmind-tools"
export XMIND2MD="$XMIND_TOOLS_SKILL/scripts/xmind2md.py"
```

## 读取与转 Markdown

The converter uses only Python's standard library; Node is needed for new-file generation, not reading.
From this skill directory, use `python3 scripts/xmind2md.py`; from another directory, use the resolved `$XMIND2MD` path above.

```bash
python3 "$XMIND2MD" input.xmind --list-sheets
python3 "$XMIND2MD" input.xmind --sheet 'Cases' --stdout
python3 "$XMIND2MD" input.xmind --sheet 'Cases' --out-file /tmp/cases.md
python3 "$XMIND2MD" input.xmind output.md
python3 "$XMIND2MD" input-or-directory --out testcase_md
```

Repeat `--sheet` for multiple exact sheet titles. Sheet selection/listing requires a single file.
Without `--stdout` or `--out-file`, conversion writes under `--out` and prints the destination.
A final positional `.md` argument selects an output file. Prefer `--out-file` when reading a large map in sections.
Root topics become `#`, second-level topics `##`, and deeper topics list items.
Conversion failures are reported in output (`status: conversion_failed`); a zero exit code alone does not prove success.
Topic markers and sheet legends are omitted from Markdown; inspect them with the editor/JSON paths below.

## Setup

Run once if `node_modules` is absent:

```bash
npm --prefix "$XMIND_TOOLS_SKILL/scripts" install
```

## Split Or Derive From An Existing XMind

When creating a new `.xmind` from an existing sheet or case file, preserve the original canvas/theme/layout by copying the source file first, then edit the copy. Do not use `xmind_new.mjs` for this path unless the user explicitly wants a fresh default canvas.

Recommended flow:
1. Copy the original `.xmind` to the target path.
2. Remove unrelated sheets or replace the target sheet in the copy.
3. Rename the sheet title and root topic as needed.
4. Read back with `xmind2md`; when visual formatting matters, open or render-check the resulting file.

## Create A New XMind From Scratch

Use this only when no old canvas/theme/layout needs to be reused.

Prepare an outline with exactly one root topic. Use tabs or four spaces for one level of indentation.

```text
#14777
	挑战券
		初始数量
		恢复规则
	战斗
```

Then generate the file:

```bash
node "$XMIND_TOOLS_SKILL/scripts/xmind_new.mjs" --input outline.txt --output out.xmind
```

## Inspect Existing Files

List sheets and topics before editing. Use topic IDs for node-level writes.

```bash
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind list-sheets
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind list-topics --sheet '#14777'
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind list-topics --sheet '#14777' --json
```

## Modify Existing Files

Write to `--output` by default:

```bash
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind replace-sheet --sheet '#14777' --input outline.txt
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind add-child --parent-id <topic-id> --title '新增节点'
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind add-subtree --parent-id <topic-id> --input subtree.txt
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind update-title --topic-id <topic-id> --title '新标题'
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind set-marker --topic-id <topic-id> --marker-id flag-green --marker-id people-blue
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind clear-marker --topic-id <topic-id> --marker-id people-blue
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind set-legend --sheet '画布 1' --visibility visible --marker flag-green=白盒已确认 --marker people-blue=人工测试 --marker star-green=协议覆盖 --x -232.440673828125 --y -238.9000244140625
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind move-topic --topic-id <topic-id> --new-parent-id <topic-id> --index 0
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source case.xmind --output out.xmind delete-topic --topic-id <topic-id>
```

Use `--in-place` only for confirmed direct overwrite. It creates `<source>.bak` before saving.

Marker and legend notes:
- `set-marker` replaces existing markers by default; add `--append` to keep existing markers and add missing ones.
- `clear-marker` removes all markers unless one or more `--marker-id` values are provided.
- `set-legend` writes sheet-level `legend.markers`; repeat `--marker marker-id=name` for each legend entry. Use `--replace` to replace the marker map instead of merging it.
- `xmind2md` read-back checks do not show topic markers or sheet legends. Use `list-topics --json` for markers, title paths and plain notes; sheet legends remain in `content.json` under `legend.markers`.

## Verification

After every write, read the result back and confirm the intended sheet or topic changed and unrelated sheets remain:

```bash
python3 "$XMIND2MD" out.xmind --stdout
```

For marker checks, list topics as JSON (`sheet` is the sheet title, `topic_id` identifies the node, `path` is a title array, `markers` contains marker IDs, and `notes` is omitted when plain text is absent). Inspect sheet-level `legend.markers` in the archive separately for legend checks:

```bash
python3 "$XMIND_TOOLS_SKILL/scripts/xmind_edit.py" --source out.xmind list-topics --json
```

For script checks:

```bash
python3 -m unittest discover -s "$XMIND_TOOLS_SKILL/scripts" -p 'test_*.py' -v
npm --prefix "$XMIND_TOOLS_SKILL/scripts" audit --omit=dev
```
