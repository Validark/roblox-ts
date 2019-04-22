import * as ts from "ts-morph";
import {
	transpileBlock,
	transpileBreakStatement,
	transpileClassDeclaration,
	transpileContinueStatement,
	transpileDoStatement,
	transpileEnumDeclaration,
	transpileExportAssignment,
	transpileExportDeclaration,
	transpileExpressionStatement,
	transpileForOfStatement,
	transpileForStatement,
	transpileFunctionDeclaration,
	transpileIfStatement,
	transpileImportDeclaration,
	transpileImportEqualsDeclaration,
	transpileNamespaceDeclaration,
	transpileReturnStatement,
	transpileSwitchStatement,
	transpileThrowStatement,
	transpileTryStatement,
	transpileVariableStatement,
	transpileWhileStatement,
} from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { isTypeStatement } from "../typeUtilities";

export function transpileStatement(state: TranspilerState, node: ts.Statement): string {
	state.enterPreStatementContext();
	let result: string;

	/* istanbul ignore else  */
	if (
		isTypeStatement(node) ||
		ts.TypeGuards.isEmptyStatement(node) ||
		ts.TypeGuards.isTypeAliasDeclaration(node) ||
		ts.TypeGuards.isInterfaceDeclaration(node)
	) {
		result = "";
	} else if (ts.TypeGuards.isBlock(node)) {
		result = transpileBlock(state, node);
	} else if (ts.TypeGuards.isImportDeclaration(node)) {
		result = transpileImportDeclaration(state, node);
	} else if (ts.TypeGuards.isImportEqualsDeclaration(node)) {
		result = transpileImportEqualsDeclaration(state, node);
	} else if (ts.TypeGuards.isExportDeclaration(node)) {
		result = transpileExportDeclaration(state, node);
	} else if (ts.TypeGuards.isFunctionDeclaration(node)) {
		result = transpileFunctionDeclaration(state, node);
	} else if (ts.TypeGuards.isClassDeclaration(node)) {
		result = transpileClassDeclaration(state, node);
	} else if (ts.TypeGuards.isNamespaceDeclaration(node)) {
		result = transpileNamespaceDeclaration(state, node);
	} else if (ts.TypeGuards.isDoStatement(node)) {
		result = transpileDoStatement(state, node);
	} else if (ts.TypeGuards.isIfStatement(node)) {
		result = transpileIfStatement(state, node);
	} else if (ts.TypeGuards.isBreakStatement(node)) {
		result = transpileBreakStatement(state, node);
	} else if (ts.TypeGuards.isExpressionStatement(node)) {
		result = transpileExpressionStatement(state, node);
	} else if (ts.TypeGuards.isContinueStatement(node)) {
		result = transpileContinueStatement(state, node);
	} else if (ts.TypeGuards.isForInStatement(node)) {
		throw new TranspilerError("For..in loops are disallowed!", node, TranspilerErrorType.ForInLoop);
	} else if (ts.TypeGuards.isForOfStatement(node)) {
		result = transpileForOfStatement(state, node);
	} else if (ts.TypeGuards.isForStatement(node)) {
		result = transpileForStatement(state, node);
	} else if (ts.TypeGuards.isReturnStatement(node)) {
		result = transpileReturnStatement(state, node);
	} else if (ts.TypeGuards.isThrowStatement(node)) {
		result = transpileThrowStatement(state, node);
	} else if (ts.TypeGuards.isVariableStatement(node)) {
		result = transpileVariableStatement(state, node);
	} else if (ts.TypeGuards.isWhileStatement(node)) {
		result = transpileWhileStatement(state, node);
	} else if (ts.TypeGuards.isEnumDeclaration(node)) {
		result = transpileEnumDeclaration(state, node);
	} else if (ts.TypeGuards.isExportAssignment(node)) {
		result = transpileExportAssignment(state, node);
	} else if (ts.TypeGuards.isSwitchStatement(node)) {
		result = transpileSwitchStatement(state, node);
	} else if (ts.TypeGuards.isTryStatement(node)) {
		result = transpileTryStatement(state, node);
	} else if (ts.TypeGuards.isLabeledStatement(node)) {
		throw new TranspilerError(
			"Labeled statements are not supported!",
			node,
			TranspilerErrorType.NoLabeledStatement,
		);
	} else {
		/* istanbul ignore next */
		throw new TranspilerError(`Bad statement! (${node.getKindName()})`, node, TranspilerErrorType.BadStatement);
	}

	return state.exitPreStatementContext() + result;
}

export function transpileStatementedNode(state: TranspilerState, node: ts.Node & ts.StatementedNode) {
	state.pushIdStack();
	state.exportStack.push(new Set<string>());
	let result = "";
	state.hoistStack.push(new Set<string>());
	for (const child of node.getStatements()) {
		result += transpileStatement(state, child);
		if (child.getKind() === ts.SyntaxKind.ReturnStatement) {
			break;
		}
	}

	result = state.popHoistStack(result);

	const scopeExports = state.exportStack.pop();
	if (scopeExports && scopeExports.size > 0) {
		scopeExports.forEach(scopeExport => (result += state.indent + scopeExport));
	}
	state.popIdStack();
	return result;
}
