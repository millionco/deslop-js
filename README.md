# deslop-js

[![version](https://img.shields.io/npm/v/deslop-js?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)
[![downloads](https://img.shields.io/npm/dt/deslop-js.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/deslop-js)

High-performance dead code detector for TypeScript/JavaScript using the OXC toolchain.

## Install

```bash
npm install deslop-js
```

## Usage

```ts
import { analyze } from "deslop-js";

const result = await analyze({ cwd: "./my-project" });
```

### CLI

```bash
npx deslop-js
```

## Development

This is a pnpm monorepo using [vite-plus](https://github.com/nicolo-ribaudo/vite-plus) for building and [changesets](https://github.com/changesets/changesets) for versioning.

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

### Lint & Format

```bash
pnpm lint
pnpm format
```

### Release

```bash
pnpm changeset       # create a changeset
pnpm version         # bump versions
pnpm release         # build + publish
```

## Contributing

Pull requests are welcome! Please run `pnpm check` before submitting.

## License

MIT
