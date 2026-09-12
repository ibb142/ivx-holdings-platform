import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../expo/package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { parse } = require('@babel/parser');

for (const route of ['lender-directory', 'lender-search']) {
  test(`${route} mounts its lender context before the directly opened screen`, () => {
    const source = readFileSync(new URL(`../../expo/app/admin/${route}.tsx`, import.meta.url), 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const declaration = ast.program.body.find((node: any) => node.type === 'ExportDefaultDeclaration')?.declaration;
    expect(declaration?.type).toBe('FunctionDeclaration');
    const Context = React.createContext(undefined);
    const records = [{ id: 'saved-lender', name: 'Saved lender' }];
    const LenderProvider = ({ children }: any) => React.createElement(Context.Provider, { value: { allLenders: records } }, children);
    const Consumer = () => {
      const { allLenders } = React.useContext(Context);
      return React.createElement('p', null, allLenders[0].name);
    };
    const code = new Bun.Transpiler({ loader: 'tsx', tsconfig: { compilerOptions: { jsx: 'react' } } })
      .transformSync(source.slice(declaration.start, declaration.end));
    const api: any = {};
    runInNewContext(code + `\napi.Route = ${declaration.id.name};`, {
      api, React, LenderProvider, LenderDirectoryContent: Consumer, LenderSearchScreenContent: Consumer,
      useRealtimeTable() {}, useRouter: () => ({}), useLenders: () => React.useContext(Context),
    });
    expect(renderToStaticMarkup(React.createElement(api.Route))).toBe('<p>Saved lender</p>');
  });
}
