import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const documentationRoot = path.join(repositoryRoot, "docs");
const markdownLinkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectMarkdownFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  }));
  return nested.flat();
}

function isLocalDocumentLink(target: string): boolean {
  return !target.startsWith("#") &&
    !target.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

const markdownFiles = [path.join(repositoryRoot, "README.md"), ...await collectMarkdownFiles(documentationRoot)];
const missingLinks: string[] = [];

for (const markdownFile of markdownFiles) {
  const content = await readFile(markdownFile, "utf8");
  for (const match of content.matchAll(markdownLinkPattern)) {
    const rawTarget = match[1];
    const target = rawTarget.split(/[?#]/, 1)[0];
    if (!target || !isLocalDocumentLink(target)) {
      continue;
    }

    const resolvedTarget = path.resolve(path.dirname(markdownFile), target);
    if (!await pathExists(resolvedTarget)) {
      missingLinks.push(`${path.relative(repositoryRoot, markdownFile)} -> ${rawTarget}`);
    }
  }
}

if (missingLinks.length > 0) {
  console.error("Missing local documentation links:");
  for (const link of missingLinks) {
    console.error(`- ${link}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Documentation links verified: ${markdownFiles.length} Markdown files.`);
}
