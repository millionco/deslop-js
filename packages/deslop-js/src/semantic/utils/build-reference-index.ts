import ts from "typescript";

export interface ReferenceSite {
  fileName: string;
  position: number;
  line: number;
  column: number;
  isInsideDeclaration: boolean;
  isInsideExportSpecifier: boolean;
  isInsideImportSpecifier: boolean;
}

export interface ReferenceIndex {
  get: (targetSymbol: ts.Symbol) => ReferenceSite[];
}

const resolveAlias = (symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol => {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
};

const isInsideExportSpecifier = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isExportSpecifier(current)) return true;
    if (ts.isExportAssignment(current)) return true;
    current = current.parent;
  }
  return false;
};

const isInsideImportSpecifier = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isImportSpecifier(current)) return true;
    if (ts.isImportClause(current)) return true;
    if (ts.isNamespaceImport(current)) return true;
    current = current.parent;
  }
  return false;
};

const isInsideDeclaration = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isEnumDeclaration(current) ||
      ts.isClassDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isVariableDeclaration(current) ||
      ts.isModuleDeclaration(current)
    ) {
      const declarationName = (current as ts.NamedDeclaration).name;
      if (declarationName === node) return true;
    }
    current = current.parent;
  }
  return false;
};

export const buildReferenceIndex = (
  program: ts.Program,
  checker: ts.TypeChecker,
): ReferenceIndex => {
  const indexBySymbol = new Map<ts.Symbol, ReferenceSite[]>();
  const visit = (sourceFile: ts.SourceFile): void => {
    const collectFromNode = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
          const resolvedSymbol = resolveAlias(symbol, checker);
          const lineAndChar = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          const site: ReferenceSite = {
            fileName: sourceFile.fileName,
            position: node.getStart(sourceFile),
            line: lineAndChar.line + 1,
            column: lineAndChar.character,
            isInsideDeclaration: isInsideDeclaration(node),
            isInsideExportSpecifier: isInsideExportSpecifier(node),
            isInsideImportSpecifier: isInsideImportSpecifier(node),
          };
          const existing = indexBySymbol.get(resolvedSymbol);
          if (existing) {
            existing.push(site);
          } else {
            indexBySymbol.set(resolvedSymbol, [site]);
          }
        }
      }
      ts.forEachChild(node, collectFromNode);
    };
    collectFromNode(sourceFile);
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    visit(sourceFile);
  }

  return {
    get: (targetSymbol) => indexBySymbol.get(resolveAlias(targetSymbol, checker)) ?? [],
  };
};
