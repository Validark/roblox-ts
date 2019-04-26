import * as ts from "ts-morph";
import { ScriptContext } from "./utility";

interface Partition {
	dir: ts.Directory;
	target: string;
}

export class TranspilerState {
	constructor(public readonly syncInfo: Array<Partition>, public readonly modulesDir?: ts.Directory) {}
	public preStatementContext = new Array<Array<string>>();

	public pushPreStatement(...strs: Array<string>) {
		this.preStatementContext[this.preStatementContext.length - 1].push(...strs);
	}

	public pushPreStatementToNextId(transpiledSource: string, nextCachedStrs?: Array<string>) {
		/** Gets the top PreStatement to compare to */
		let previousTop: string | undefined;

		for (let i = this.preStatementContext.length - 1; 0 <= i; i--) {
			const context = this.preStatementContext[i];
			const topPreStatement = context[context.length - 1];
			if (topPreStatement) {
				previousTop = topPreStatement;
				break;
			}
		}

		for (const top of [previousTop, nextCachedStrs ? nextCachedStrs[0] : undefined]) {
			/** If we would write a duplicate `local _5 = i`, skip it */
			if (top) {
				const matchesRegex = top.match(/^(\t*)local (_\d+) = ([^;]+);\n$/);
				if (matchesRegex) {
					const [, indentation, currentId, data] = matchesRegex;
					if (indentation === this.indent && data === transpiledSource) {
						return currentId;
					}
				}
			}
		}

		const newId = this.getNewId();
		this.pushPreStatement(this.indent + `local ${newId} = ${transpiledSource};\n`);
		return newId;
	}

	public enterPreStatementContext() {
		const newContext = new Array<string>();
		this.preStatementContext.push(newContext);
		return newContext;
	}

	/** Exits a preStatement context and returns the popped layer so it may be appended */
	public exitPreStatementContext(numTabs: number = 0) {
		const sep = "\t".repeat(numTabs);
		return sep + this.preStatementContext.pop()!.join(sep);
	}

	public hasPreStatementsInContext() {
		return this.preStatementContext[this.preStatementContext.length - 1].length > 0;
	}

	public currentConditionalContext: string = "";

	// indent
	public indent = "";

	public pushIndent() {
		this.indent += "\t";
	}

	public popIndent() {
		this.indent = this.indent.substr(1);
	}

	// id stack
	public idStack = new Array<number>();

	public pushIdStack() {
		this.idStack.push(0);
	}

	public popIdStack() {
		this.idStack.pop();
	}

	public getNewId() {
		const sum = this.idStack.reduce((accum, value) => accum + value);
		this.idStack[this.idStack.length - 1]++;
		return `_${sum}`;
	}

	// hoist stack
	public hoistStack = new Array<Set<string>>();

	public pushHoistStack(name: string) {
		this.hoistStack[this.hoistStack.length - 1].add(name);
	}

	public popHoistStack(result: string) {
		const top = this.hoistStack.pop();
		if (top) {
			const hoists = [...top];
			const namedHoists = new Array<string>();
			const declareHoists = new Array<string>();
			hoists.forEach(v => (v.includes("=") ? declareHoists : namedHoists).push(v));

			if (namedHoists && namedHoists.length > 0) {
				result = this.indent + `local ${namedHoists.join(", ")};\n` + result;
			}

			if (declareHoists && declareHoists.length > 0) {
				result = this.indent + `${declareHoists.join(";\n" + this.indent)};\n` + result;
			}
		}
		return result;
	}

	// export stack
	public exportStack = new Array<Set<string>>();

	public pushExport(name: string, node: ts.Node & ts.ExportableNode) {
		if (!node.hasExportKeyword()) {
			return;
		}

		const ancestorName = this.getExportContextName(node);
		const alias = node.hasDefaultKeyword() ? "_default" : name;
		this.exportStack[this.exportStack.length - 1].add(`${ancestorName}.${alias} = ${name};\n`);
	}

	public getNameForContext(myNamespace: ts.NamespaceDeclaration | undefined): string {
		let name;

		if (myNamespace) {
			name = myNamespace.getName();
			name = this.namespaceStack.get(name) || name;
		} else {
			name = "_exports";
			this.isModule = true;
		}

		return name;
	}

	public getExportContextName(node: ts.VariableStatement | ts.Node): string {
		return this.getNameForContext(node.getFirstAncestorByKind(ts.SyntaxKind.ModuleDeclaration));
	}

	// in the form: { ORIGINAL_IDENTIFIER = REPLACEMENT_VALUE }
	// For example, this is used for  exported/namespace values
	// which should be represented differently in Lua than they
	// can be represented in TS
	public variableAliases = new Map<string, string>();

	public getAlias(name: string) {
		const alias = this.variableAliases.get(name);
		if (alias !== undefined) {
			return alias;
		} else {
			return name;
		}
	}

	public namespaceStack = new Map<string, string>();
	public continueId = -1;
	public isModule = false;
	public scriptContext = ScriptContext.None;
	public roactIndent: number = 0;
	public hasRoactImport: boolean = false;
	public usesTSLibrary = false;
}
