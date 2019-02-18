import * as ts from "ts-morph";
import { checkReserved, transpileExpression } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { shouldHoist } from "../typeUtilities";
import { transpileArrayEqualsExpression } from "./binary";

export function transpileVariableDeclaration(state: TranspilerState, node: ts.VariableDeclaration) {
	const lhs = node.getNameNode();
	const rhs = node.getInitializer();

	const parent = node.getParent();
	const grandParent = parent.getParent();
	const isExported = ts.TypeGuards.isVariableStatement(grandParent) && grandParent.isExported();

	let decKind = ts.VariableDeclarationKind.Const;
	if (ts.TypeGuards.isVariableDeclarationList(parent)) {
		decKind = parent.getDeclarationKind();
	}

	let parentName = "";
	if (isExported) {
		parentName = state.getExportContextName(grandParent);
	}

	let result = "";
	if (ts.TypeGuards.isIdentifier(lhs)) {
		const name = lhs.getText();
		checkReserved(name, lhs, true);
		if (rhs) {
			const value = transpileExpression(state, rhs);
			if (isExported && decKind === ts.VariableDeclarationKind.Let) {
				result += state.indent + `${parentName}.${name} = ${value};\n`;
			} else {
				if (isExported && ts.TypeGuards.isVariableStatement(grandParent)) {
					state.pushExport(name, grandParent);
				}
				if (shouldHoist(grandParent, lhs)) {
					state.pushHoistStack(name);
					result += state.indent + `${name} = ${value};\n`;
				} else {
					result += state.indent + `local ${name} = ${value};\n`;
				}
			}
		} else if (!isExported) {
			if (shouldHoist(grandParent, lhs)) {
				state.pushHoistStack(name);
			} else {
				result += state.indent + `local ${name};\n`;
			}
		}
	} else if ((ts.TypeGuards.isArrayBindingPattern(lhs) || ts.TypeGuards.isObjectBindingPattern(lhs)) && rhs) {
		// binding patterns MUST have rhs

		const names = new Array<string>();
		const values = new Array<string>();
		const isLet = decKind === ts.VariableDeclarationKind.Let;
		const shouldLocalize = !isExported || !isLet;
		const [expStr] = transpileArrayEqualsExpression(
			state,
			lhs,
			rhs,
			shouldLocalize,
			names,
			values,
			isExported,
			decKind,
		);
		result += expStr;

		if (values.length > 0) {
			if (isExported && !isLet && ts.TypeGuards.isVariableStatement(grandParent)) {
				names.forEach(name => state.pushExport(name, grandParent));
			}
		}
	}

	return result;
}

export function transpileVariableDeclarationList(state: TranspilerState, node: ts.VariableDeclarationList) {
	const declarationKind = node.getDeclarationKind();
	if (declarationKind === ts.VariableDeclarationKind.Var) {
		throw new TranspilerError(
			"'var' keyword is not supported! Use 'let' or 'const' instead.",
			node,
			TranspilerErrorType.NoVarKeyword,
		);
	}

	let result = "";
	for (const declaration of node.getDeclarations()) {
		result += transpileVariableDeclaration(state, declaration);
	}
	return result;
}

export function transpileVariableStatement(state: TranspilerState, node: ts.VariableStatement) {
	const list = node.getFirstChildByKindOrThrow(ts.SyntaxKind.VariableDeclarationList);
	return transpileVariableDeclarationList(state, list);
}
