import * as ts from "ts-morph";
import { transpileExpression } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { transpileRawIdentifier } from "./identifier";

function isUnaryNonStatement(parent: ts.Node<ts.ts.Node>, node: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression) {
	return !(
		ts.TypeGuards.isExpressionStatement(parent) ||
		(ts.TypeGuards.isForStatement(parent) && parent.getCondition() !== node)
	);
}

function getUnaryExpressionString(state: TranspilerState, operand: ts.UnaryExpression) {
	if (ts.TypeGuards.isPropertyAccessExpression(operand)) {
		const expression = operand.getExpression();
		const opExpStr = transpileExpression(state, expression);
		const propertyStr = operand.getName();
		const id = state.pushPreStatementToNextId(opExpStr);
		return `${id}.${propertyStr}`;
	} else if (ts.TypeGuards.isIdentifier(operand)) {
		return transpileRawIdentifier(state, operand);
	} else {
		return transpileExpression(state, operand);
	}
}

function getIncrementString(opKind: ts.ts.PrefixUnaryOperator, expStr: string, node: ts.Node) {
	if (opKind === ts.SyntaxKind.PlusPlusToken) {
		return `${expStr} = ${expStr} + 1`;
	} else if (opKind === ts.SyntaxKind.MinusMinusToken) {
		return `${expStr} = ${expStr} - 1`;
	} else {
		/* istanbul ignore next */
		throw new TranspilerError(
			`Bad unary expression! (${opKind})`,
			node,
			TranspilerErrorType.BadPrefixUnaryExpression,
		);
	}
}

/** Returns an array of descendants which occur in the current statement, after the given node */
// function getFirstStatementAncestorDescendants(operand: ts.Node) {
// 	const descendants = new Array<ts.Node>();
// 	let parent: ts.Node | undefined = operand;

// 	while (parent) {
// 		const previousParent = parent;
// 		parent = parent.getParent();
// 	}
// 	return operand.getParent()!.getDescendants();
// }

export function transpilePrefixUnaryExpression(state: TranspilerState, node: ts.PrefixUnaryExpression) {
	const operand: ts.UnaryExpression = node.getOperand();
	const opKind = node.getOperatorToken();

	if (opKind === ts.SyntaxKind.PlusPlusToken || opKind === ts.SyntaxKind.MinusMinusToken) {
		const parent = node.getParentOrThrow();
		const isNonStatement = isUnaryNonStatement(parent, node);
		state.enterPreStatementContext();
		const expStr = getUnaryExpressionString(state, operand);
		const incrStr = getIncrementString(opKind, expStr, node);

		if (isNonStatement) {
			// const firstStatementAncestorDescendants = getFirstStatementAncestorDescendants(operand);

			// if (ts.TypeGuards.isReferenceFindableNode(operand)) {
			// 	operand.findReferencesAsNodes().some(ref => {
			// 		for (const descendant of firstStatementAncestorDescendants) {
			// 			if (ref === descendant) {
			// 				return true;
			// 			}
			// 		}
			// 		return false;
			// 	});
			// }
			const id = state.getNewId();
			state.pushPreStatement(state.indent + incrStr + ";\n");
			state.pushPreStatement(state.indent + `local ${id} = ${expStr};\n`);
			state.pushPreStatement(...state.preStatementContext.pop()!);
			return id;
		} else {
			state.pushPreStatement(incrStr);
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
		const isNonStatement = isUnaryNonStatement(parent, node);
		state.enterPreStatementContext();
		const expStr = getUnaryExpressionString(state, operand);
		const incrStr = getIncrementString(opKind, expStr, node);

		if (isNonStatement) {
			const id = state.pushPreStatementToNextId(expStr);
			state.pushPreStatement(state.indent + incrStr + ";\n");
			state.pushPreStatement(...state.preStatementContext.pop()!);
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
