// Remove the previous build output, so a renamed or deleted source file can't
// leave a stale module behind in the published package.
//
// A script rather than `rm -rf dist` in the npm script: this runs on Windows
// too, and it can refuse to delete anything that isn't the directory it means.
//
// This used to also rewrite module specifiers in the output, because the source
// imported `./GraphCanvas` extensionlessly and Node's ESM resolver does no
// extension probing. The source now carries explicit `.js` extensions and
// `tsconfig.build.json` uses `moduleResolution: "NodeNext"`, which makes `tsc`
// reject an extensionless relative import outright — so the output is correct
// by construction and there is nothing left to patch up.
import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(PACKAGE_ROOT, "dist");

// The basename/parent checks make a future path edit fail closed rather than
// recursively deleting somewhere unexpected.
if (
  basename(DIST) !== "dist" ||
  dirname(resolve(DIST)) !== resolve(PACKAGE_ROOT) ||
  !existsSync(join(PACKAGE_ROOT, "package.json"))
) {
  throw new Error(`refusing to clean unexpected output directory: ${DIST}`);
}

await rm(DIST, { recursive: true, force: true });
console.log(`clean-dist: cleaned ${DIST}`);
