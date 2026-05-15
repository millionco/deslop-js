export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".mdx",
  ".astro",
  ".graphql",
  ".gql",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
];

export const HIDDEN_DIRECTORY_ALLOWLIST = [
  ".storybook",
  ".vitepress",
  ".well-known",
  ".changeset",
  ".github",
];

export const DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.d.ts",
];

export const SCRIPT_FILE_PATTERN = /(?:^|\s)(?:node|tsx|ts-node|tsc|npx|bun|esr|esno|jiti)\s+(?:-[\w-]+\s+)*(?:[\w/-]+\s+)*([\w./@-]+\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs))/;

export const SCRIPT_CONFIG_FILE_PATTERN = /--config\s+([\w./@-]+\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs))/;

export const SCRIPT_ENTRY_PATTERNS = [
  "bin/*.{ts,tsx,js,jsx,mts,mjs,cjs}",
];

export const DEFAULT_ENTRY_PATTERNS = [
  "src/index.{ts,tsx,js,jsx}",
  "src/main.{ts,tsx,js,jsx}",
  "index.{ts,tsx,js,jsx}",
  "main.{ts,tsx,js,jsx}",
];

export const CONFIG_FILE_PATTERNS: RegExp[] = [
  /\.config\.(?:[cm]?[jt]sx?|[cm]js)$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /\.babelrc/,
  /jest\.config/,
  /vite\.config/,
  /vitest\.config/,
  /webpack\.config/,
  /rollup\.config/,
  /tsconfig.*\.json$/,
  /next\.config/,
  /tailwind\.config/,
  /postcss\.config/,
  /astro\.config/,
  /svelte\.config/,
  /nuxt\.config/,
];

export const ALWAYS_USED_PACKAGES = new Set([
  "typescript",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "eslint",
  "prettier",
  "husky",
  "lint-staged",
  "tslib",
]);

export const BUILTIN_MODULES = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

export const PLATFORM_SUFFIXES = [".web", ".native", ".ios", ".android", ".desktop", ".windows", ".macos"];

export const RESOLVER_EXTENSIONS = [
  ...DEFAULT_EXTENSIONS,
  ".json",
  ".node",
  ".css",
  ".scss",
  ".less",
  ".svg",
  ".png",
  ".jpg",
  ".graphql",
  ".gql",
];
