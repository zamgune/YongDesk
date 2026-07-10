import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensions = [".ts", ".tsx", ".mts", ".js", ".mjs"];

const resolvePath = (basePath) => {
  for (const extension of extensions) {
    const filePath = `${basePath}${extension}`;
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  for (const extension of extensions) {
    const filePath = join(basePath, `index${extension}`);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
};

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolvePath(join(process.cwd(), "src", specifier.slice(2)));
    if (resolved) {
      return {
        url: pathToFileURL(resolved).href,
        shortCircuit: true,
      };
    }
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const resolved = resolvePath(join(fileURLToPath(new URL(".", context.parentURL)), specifier));
    if (resolved) {
      return {
        url: pathToFileURL(resolved).href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}
