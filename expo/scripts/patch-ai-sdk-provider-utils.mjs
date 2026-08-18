import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { patchAiSdkProviderUtils } = require("./patch-ai-sdk-provider-utils.cjs");
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = patchAiSdkProviderUtils(projectRoot);
console.log(
  `[IVX postinstall] Hermes-safe AI SDK patch complete (${result.patched} file(s) patched, ${result.verifiedFiles} verified, ${result.copies} copy(ies) scanned).`,
);
