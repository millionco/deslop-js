// The dependency graph keys every file by its absolute path, but the two
// subsystems that produce those paths disagree on Windows: fast-glob always
// emits forward slashes while oxc-resolver and node:path emit backslashes.
// Lookups then silently miss and every file looks unreachable. Forward slashes
// are the canonical internal form, so collapse separators before any path is
// stored in or compared against the graph.
export const toPosixPath = (filePath: string): string => filePath.replace(/\\/g, "/");
