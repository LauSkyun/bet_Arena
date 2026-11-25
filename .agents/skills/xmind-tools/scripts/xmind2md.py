import sys
import os
import zipfile
import json
import argparse
import xml.etree.ElementTree as ET

def parse_topic(topic, level=1):
    """
    Recursively parse a topic and return markdown lines.
    level 1: # Title (Root)
    level 2: ## Section
    level 3+: - List item
    """
    lines = []
    title = topic.get("title", "Untitled")

    # Escape markdown characters if necessary? keeping it simple for now.
    # Convert newlines in titles to spaces or breaks
    title = title.replace("\n", " ")

    if level == 1:
        lines.append(f"# {title}")
    elif level == 2:
        lines.append(f"\n## {title}")
    else:
        indent = "  " * (level - 3)
        lines.append(f"{indent}- {title}")

    # Process children
    children = topic.get("children", {})
    attached = children.get("attached", [])

    for child in attached:
        lines.extend(parse_topic(child, level + 1))

    return lines

def _get_xml_title_text(elem, ns):
    title_elem = elem.find("c:title", ns)
    if title_elem is None:
        return "Untitled"
    text = "".join(title_elem.itertext()).strip()
    return text or "Untitled"

def _parse_topic_xml(topic_elem, level, ns):
    lines = []
    title = _get_xml_title_text(topic_elem, ns)
    title = title.replace("\n", " ")

    if level == 1:
        lines.append(f"# {title}")
    elif level == 2:
        lines.append(f"\n## {title}")
    else:
        indent = "  " * (level - 3)
        lines.append(f"{indent}- {title}")

    children = topic_elem.find("c:children", ns)
    if children is None:
        return lines

    for topics in children.findall("c:topics", ns):
        if topics.get("type") and topics.get("type") != "attached":
            continue
        for child in topics.findall("c:topic", ns):
            lines.extend(_parse_topic_xml(child, level + 1, ns))

    return lines

def _load_xmind_content_from_xml(xml_bytes):
    root = ET.fromstring(xml_bytes)
    ns = {"c": "urn:xmind:xmap:xmlns:content:2.0"}
    sheets = []
    for sheet in root.findall("c:sheet", ns):
        sheet_title = sheet.findtext("c:title", default="Untitled Sheet", namespaces=ns)
        root_topic = sheet.find("c:topic", ns)
        sheets.append({
            "title": sheet_title,
            "root_topic": root_topic,
        })
    return sheets, ns

def _load_xmind_document(xmind_path):
    if not zipfile.is_zipfile(xmind_path):
        raise ValueError("Not a valid zip/xmind file.")

    with zipfile.ZipFile(xmind_path, "r") as z:
        if "content.json" in z.namelist():
            with z.open("content.json") as f:
                return "json", json.load(f), None
        if "content.xml" in z.namelist():
            xml_bytes = z.read("content.xml")
            data, xml_ns = _load_xmind_content_from_xml(xml_bytes)
            return "xml", data, xml_ns

    raise ValueError("No content.json or content.xml found.")


def _list_sheet_titles(doc_type, data):
    if doc_type == "json":
        return [sheet.get("title", "Untitled Sheet") for sheet in data]
    return [sheet.get("title", "Untitled Sheet") for sheet in data]


def _build_markdown_lines(doc_type, data, xml_ns=None, selected_sheets=None):
    selected_sheets = selected_sheets or []
    selected_set = set(selected_sheets)
    found_sheets = set()
    full_md_content = []
    available_sheets = _list_sheet_titles(doc_type, data)

    if doc_type == "json":
        for sheet in data:
            sheet_title = sheet.get("title", "Untitled Sheet")
            if selected_set and sheet_title not in selected_set:
                continue

            found_sheets.add(sheet_title)
            full_md_content.extend(["", f"# Sheet: {sheet_title}", ""])
            root_topic = sheet.get("rootTopic")
            if root_topic:
                full_md_content.extend(parse_topic(root_topic, level=1))
                full_md_content.append("")
    else:
        for sheet in data:
            sheet_title = sheet.get("title", "Untitled Sheet")
            if selected_set and sheet_title not in selected_set:
                continue

            found_sheets.add(sheet_title)
            full_md_content.extend(["", f"# Sheet: {sheet_title}", ""])
            root_topic = sheet.get("root_topic")
            if root_topic is not None:
                full_md_content.extend(_parse_topic_xml(root_topic, level=1, ns=xml_ns))
                full_md_content.append("")

    if selected_set:
        missing = [sheet for sheet in selected_sheets if sheet not in found_sheets]
        if missing:
            available = ", ".join(available_sheets)
            raise ValueError(
                f"Sheet not found: {', '.join(missing)}. Available sheets: {available}"
            )

    return full_md_content, available_sheets


def convert_xmind_to_md(
    xmind_path,
    output_dir,
    output_path=None,
    selected_sheets=None,
    to_stdout=False,
):
    doc_type, data, xml_ns = _load_xmind_document(xmind_path)
    full_md_content, _ = _build_markdown_lines(
        doc_type,
        data,
        xml_ns=xml_ns,
        selected_sheets=selected_sheets,
    )
    markdown = "\n".join(full_md_content).lstrip("\n")

    if to_stdout:
        sys.stdout.write(markdown)
        if markdown and not markdown.endswith("\n"):
            sys.stdout.write("\n")
        return

    if output_path:
        final_output_path = output_path
    else:
        base_name = os.path.basename(xmind_path)
        name_without_ext = os.path.splitext(base_name)[0]
        final_output_path = os.path.join(output_dir, name_without_ext + ".md")

    output_parent = os.path.dirname(final_output_path)
    if output_parent and not os.path.exists(output_parent):
        os.makedirs(output_parent)

    with open(final_output_path, "w", encoding="utf-8") as f:
        f.write(markdown)

    print(f"Converted: {xmind_path} -> {final_output_path}")

def main():
    parser = argparse.ArgumentParser(description="Convert XMind files to Markdown outlines.")
    parser.add_argument("paths", nargs='+', help="XMind files or directories to convert. Optionally provide output .md path as last argument.")
    parser.add_argument("--out", "-o", default="testcase_md", help="Output directory")
    parser.add_argument("--out-file", help="Output file path for a single input file")
    parser.add_argument("--stdout", action="store_true", help="Write Markdown to stdout instead of a file")
    parser.add_argument("--list-sheets", action="store_true", help="List sheet titles for a single XMind file")
    parser.add_argument("--sheet", action="append", help="Exact sheet title to include. Repeatable.")

    args = parser.parse_args()

    paths = list(args.paths)
    output_file = args.out_file
    if output_file is None and len(paths) >= 2 and paths[-1].lower().endswith(".md"):
        output_file = paths.pop()

    if args.list_sheets:
        if len(paths) != 1 or os.path.isdir(paths[0]):
            parser.error("--list-sheets requires a single input file.")
        try:
            doc_type, data, _ = _load_xmind_document(paths[0])
            for title in _list_sheet_titles(doc_type, data):
                print(title)
            print("status: ok", file=sys.stderr)
        except Exception as exc:
            print(f"Error reading {paths[0]}: {exc}", file=sys.stderr)
            print("status: read_failed", file=sys.stderr)
        return

    stream_output = args.stdout or output_file == "-"
    if args.sheet and (len(paths) != 1 or os.path.isdir(paths[0])):
        parser.error("--sheet requires a single input file.")
    if stream_output and (len(paths) != 1 or os.path.isdir(paths[0])):
        parser.error("--stdout requires a single input file.")

    if output_file and output_file != "-":
        if len(paths) != 1:
            parser.error("output file can only be used with a single input file.")
        if os.path.isdir(paths[0]):
            parser.error("output file cannot be used with a directory input.")
        try:
            convert_xmind_to_md(
                paths[0],
                args.out,
                output_file,
                selected_sheets=args.sheet,
                to_stdout=False,
            )
            print("status: ok", file=sys.stderr)
        except Exception as exc:
            print(f"Error converting {paths[0]}: {exc}", file=sys.stderr)
            print("status: conversion_failed", file=sys.stderr)
        return

    if stream_output:
        try:
            convert_xmind_to_md(
                paths[0],
                args.out,
                selected_sheets=args.sheet,
                to_stdout=True,
            )
            print("status: ok", file=sys.stderr)
        except Exception as exc:
            print(f"Error converting {paths[0]}: {exc}", file=sys.stderr)
            print("status: conversion_failed", file=sys.stderr)
        return

    if not os.path.exists(args.out):
        os.makedirs(args.out)

    failed = False
    for file_path in paths:
        try:
            if os.path.isdir(file_path):
                for root, _, files in os.walk(file_path):
                    for file in files:
                        if file.lower().endswith(".xmind"):
                            convert_xmind_to_md(
                                os.path.join(root, file),
                                args.out,
                                selected_sheets=args.sheet,
                            )
            else:
                convert_xmind_to_md(
                    file_path,
                    args.out,
                    selected_sheets=args.sheet,
                )
        except Exception as exc:
            failed = True
            print(f"Error converting {file_path}: {exc}", file=sys.stderr)

    if failed:
        print("status: partial_failure", file=sys.stderr)
    else:
        print("status: ok", file=sys.stderr)

if __name__ == "__main__":
    main()
