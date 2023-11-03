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

## Examples

Generating clientlib headers
```
ts2cpp --default-lib --pretty node_modules/typescript/lib/lib.d.ts node_modules/typescript/lib/lib.es2017.d.ts
```

Generating headers from a custom declaration file
```
ts2cpp --pretty test.d.ts -o test.h
```
