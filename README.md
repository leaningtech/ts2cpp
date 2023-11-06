A tool to generate c++ headers from typescript declaration files (.d.ts) for use with [Cheerp](https://github.com/leaningtech/cheerp-meta).

```
Usage: ts2cpp [options]

Options:
  --pretty
  --default-lib
  --out, -o <file>
  --ignore-errors
  -h, --help        display help for command
```

## Setup

```
git clone https://github.com/leaningtech/ts2cpp.git
cd ts2cpp
npm i && npx tsc
```

## Examples

Generating clientlib headers
```
mkdir -p cheerp
node . --default-lib --pretty node_modules/typescript/lib/lib.d.ts node_modules/typescript/lib/lib.es2017.d.ts node_modules/typescript/lib/lib.es2020.bigint.d.ts
```

Generating headers from a custom declaration file
```
node . --pretty test.d.ts -o test.h
```
