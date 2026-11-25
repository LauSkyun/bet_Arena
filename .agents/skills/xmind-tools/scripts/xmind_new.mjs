#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, RootTopic, Topic } from 'xmind-generator';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      throw new Error(`Unexpected argument: ${key}`);
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function lineInfo(rawLine) {
  const line = rawLine.replace(/\r$/, '');
  if (!line.trim()) return null;
  const match = line.match(/^(\s*)(.*)$/);
  const leading = match?.[1] ?? '';
  const title = (match?.[2] ?? '').trim();
  if (!title) return null;
  let level = 0;
  for (const ch of leading) {
    level += ch === '\t' ? 1 : 0.25;
  }
  return { level: Math.floor(level), title };
}

function parseOutline(text) {
  const root = { title: null, children: [] };
  const stack = [{ level: -1, node: root }];
  for (const rawLine of text.split('\n')) {
    const info = lineInfo(rawLine);
    if (!info) continue;
    const node = { title: info.title, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= info.level) {
      stack.pop();
    }
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level: info.level, node });
  }
  if (root.children.length !== 1) {
    throw new Error('Outline must contain exactly one root topic');
  }
  return root.children[0];
}

function buildTopic(node) {
  const children = node.children.map(buildTopic);
  return Topic(node.title).children(children);
}

function buildRoot(node) {
  return RootTopic(node.title)
    .sheetTitle(node.title)
    .children(node.children.map(buildTopic));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    throw new Error('Usage: xmind_new.mjs --input outline.txt --output output.xmind');
  }
  const outline = await fs.readFile(args.input, 'utf8');
  const tree = parseOutline(outline);
  const workbook = Workbook(buildRoot(tree));
  const buffer = Buffer.from(await workbook.archive());
  await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await fs.writeFile(args.output, buffer);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
