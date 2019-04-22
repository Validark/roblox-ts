import * as ts from "ts-morph";
import { transpileExpression } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";

function useIIFEforUnaryExpression(
	parent: ts.Node<ts.ts.Node>,
	node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
) {
	return !(
		ts.TypeGuards.isExpressionStatement(parent) ||
		(ts.TypeGuards.isForStatement(parent) && parent.getCondition() !== node)
	);
}

export function transpilePrefixUnaryExpression(state: TranspilerState, node: ts.PrefixUnaryExpression) {
	const operand = node.getOperand();
	const opKind = node.getOperatorToken();

	if (opKind === ts.SyntaxKind.PlusPlusToken || opKind === ts.SyntaxKind.MinusMinusToken) {
		const parent = node.getParentOrThrow();
		const useIIFE = useIIFEforUnaryExpression(parent, node);
		state.enterPreStatementContext();
		let expStr: string;
		if (ts.TypeGuards.isPropertyAccessExpression(operand)) {
			const expression = operand.getExpression();
			const opExpStr = transpileExpression(state, expression);
			const propertyStr = operand.getName();
			const id = state.getNewId();
			state.pushPreStatement(state.indent + `local ${id} = ${opExpStr};\n`);
			expStr = `${id}.${propertyStr}`;
		} else {
			expStr = transpileExpression(state, operand);
		}

		if (opKind === ts.SyntaxKind.PlusPlusToken) {
			state.pushPreStatement(state.indent + `${expStr} = ${expStr} + 1;\n`);
		} else if (opKind === ts.SyntaxKind.MinusMinusToken) {
			state.pushPreStatement(state.indent + `${expStr} = ${expStr} - 1;\n`);
		}

		if (useIIFE) {
			state.pushPreStatement(state.exitPreStatementContext());
			return expStr;
		} else {
			return state.exitPreStatementContext();
		}
	} else {
		const expStr = transpileExpression(state, operand);
		const tokenKind = node.getOperatorToken();
		if (tokenKind === ts.SyntaxKind.ExclamationToken) {
			return `not ${expStr}`;
		} else if (tokenKind === ts.SyntaxKind.MinusToken) {
			return `-${expStr}`;
		} else {
			/* istanbul ignore next */
			throw new TranspilerError(
				`Bad prefix unary expression! (${tokenKind})`,
				node,
				TranspilerErrorType.BadPrefixUnaryExpression,
			);
		}
	}
}

export function transpilePostfixUnaryExpression(state: TranspilerState, node: ts.PostfixUnaryExpression) {
	const operand = node.getOperand();
	const opKind = node.getOperatorToken();
	if (opKind === ts.SyntaxKind.PlusPlusToken || opKind === ts.SyntaxKind.MinusMinusToken) {
		const parent = node.getParentOrThrow();
		const useIIFE = useIIFEforUnaryExpression(parent, node);
		state.enterPreStatementContext();
		let expStr: string;
		if (ts.TypeGuards.isPropertyAccessExpression(operand)) {
			const expression = operand.getExpression();
			const opExpStr = transpileExpression(state, expression);
			const propertyStr = operand.getName();
			const id = state.getNewId();
			state.pushPreStatement(state.indent + `local ${id} = ${opExpStr};\n`);
			expStr = `${id}.${propertyStr}`;
		} else {
			expStr = transpileExpression(state, operand);
		}

		const incrStr =
			state.indent +
			(opKind === ts.SyntaxKind.PlusPlusToken ? `${expStr} = ${expStr} + 1;\n` : `${expStr} = ${expStr} - 1;\n`);

		if (useIIFE) {
			const id = state.getNewId();
			state.pushPreStatement(state.indent + `local ${id} = ${expStr};\n`);
			state.pushPreStatement(incrStr);
			state.pushPreStatement(state.exitPreStatementContext());
			return id;
		} else {
			state.pushPreStatement(incrStr);
			return state.exitPreStatementContext();
		}
	} else {
		/* istanbul ignore next */
		throw new TranspilerError(
			`Bad postfix unary expression! (${opKind})`,
			node,
			TranspilerErrorType.BadPostfixUnaryExpression,
		);
	}
}
