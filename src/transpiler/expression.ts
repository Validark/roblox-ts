import * as ts from "ts-morph";
import {
	isSetToken,
	transpileArrayLiteralExpression,
	transpileAwaitExpression,
	transpileBinaryExpression,
	transpileBooleanLiteral,
	transpileCallExpression,
	transpileClassExpression,
	transpileConditionalExpression,
	transpileElementAccessExpression,
	transpileFunctionExpression,
	transpileIdentifier,
	transpileJsxElement,
	transpileJsxSelfClosingElement,
	transpileNewExpression,
	transpileNumericLiteral,
	transpileObjectLiteralExpression,
	transpileParenthesizedExpression,
	transpilePostfixUnaryExpression,
	transpilePrefixUnaryExpression,
	transpilePropertyAccessExpression,
	transpileSpreadElement,
	transpileStringLiteral,
	transpileTemplateExpression,
} from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { isIdentifierWhoseDefinitionMatchesNode } from "../utility";

export function transpileExpression(state: TranspilerState, node: ts.Expression): string {
	if (ts.TypeGuards.isStringLiteral(node) || ts.TypeGuards.isNoSubstitutionTemplateLiteral(node)) {
		return transpileStringLiteral(state, node);
	} else if (ts.TypeGuards.isNumericLiteral(node)) {
		return transpileNumericLiteral(state, node);
	} else if (ts.TypeGuards.isBooleanLiteral(node)) {
		return transpileBooleanLiteral(state, node);
	} else if (ts.TypeGuards.isArrayLiteralExpression(node)) {
		return transpileArrayLiteralExpression(state, node);
	} else if (ts.TypeGuards.isObjectLiteralExpression(node)) {
		return transpileObjectLiteralExpression(state, node);
	} else if (ts.TypeGuards.isFunctionExpression(node) || ts.TypeGuards.isArrowFunction(node)) {
		return transpileFunctionExpression(state, node);
	} else if (ts.TypeGuards.isCallExpression(node)) {
		return transpileCallExpression(state, node);
	} else if (ts.TypeGuards.isIdentifier(node)) {
		return transpileIdentifier(state, node);
	} else if (ts.TypeGuards.isBinaryExpression(node)) {
		return transpileBinaryExpression(state, node);
	} else if (ts.TypeGuards.isPrefixUnaryExpression(node)) {
		return transpilePrefixUnaryExpression(state, node);
	} else if (ts.TypeGuards.isPostfixUnaryExpression(node)) {
		return transpilePostfixUnaryExpression(state, node);
	} else if (ts.TypeGuards.isPropertyAccessExpression(node)) {
		return transpilePropertyAccessExpression(state, node);
	} else if (ts.TypeGuards.isNewExpression(node)) {
		return transpileNewExpression(state, node);
	} else if (ts.TypeGuards.isParenthesizedExpression(node)) {
		return transpileParenthesizedExpression(state, node);
	} else if (ts.TypeGuards.isTemplateExpression(node)) {
		return transpileTemplateExpression(state, node);
	} else if (ts.TypeGuards.isElementAccessExpression(node)) {
		return transpileElementAccessExpression(state, node);
	} else if (ts.TypeGuards.isAwaitExpression(node)) {
		return transpileAwaitExpression(state, node);
	} else if (ts.TypeGuards.isConditionalExpression(node)) {
		return transpileConditionalExpression(state, node);
	} else if (ts.TypeGuards.isJsxExpression(node)) {
		return transpileExpression(state, node.getExpressionOrThrow());
	} else if (ts.TypeGuards.isJsxSelfClosingElement(node)) {
		return transpileJsxSelfClosingElement(state, node);
	} else if (ts.TypeGuards.isJsxElement(node)) {
		return transpileJsxElement(state, node);
	} else if (ts.TypeGuards.isSpreadElement(node)) {
		return transpileSpreadElement(state, node);
	} else if (ts.TypeGuards.isClassExpression(node)) {
		return transpileClassExpression(state, node);
	} else if (ts.TypeGuards.isOmittedExpression(node)) {
		return "nil";
	} else if (ts.TypeGuards.isThisExpression(node)) {
		if (
			!node.getFirstAncestorByKind(ts.SyntaxKind.ClassDeclaration) &&
			!node.getFirstAncestorByKind(ts.SyntaxKind.ObjectLiteralExpression) &&
			!node.getFirstAncestorByKind(ts.SyntaxKind.ClassExpression)
		) {
			throw new TranspilerError(
				"'this' may only be used inside a class definition or object literal",
				node,
				TranspilerErrorType.NoThisOutsideClass,
			);
		}
		return "self";
	} else if (ts.TypeGuards.isSuperExpression(node)) {
		return "super";
	} else if (
		ts.TypeGuards.isAsExpression(node) ||
		ts.TypeGuards.isTypeAssertion(node) ||
		ts.TypeGuards.isNonNullExpression(node)
	) {
		return transpileExpression(state, node.getExpression());
	} else if (ts.TypeGuards.isNullLiteral(node)) {
		throw new TranspilerError(
			"'null' is not supported! Use 'undefined' instead.",
			node,
			TranspilerErrorType.NoNull,
		);
	} else if (ts.TypeGuards.isTypeOfExpression(node)) {
		throw new TranspilerError(
			"'typeof' operator is not supported! Use `typeIs(value, type)` or `typeOf(value)` instead.",
			node,
			TranspilerErrorType.NoTypeOf,
		);
	} else if (ts.TypeGuards.isYieldExpression(node)) {
		const exp = node.getExpression();
		let result = `coroutine.yield({\n`;
		state.pushIndent();
		result += state.indent + `value = ${exp ? transpileExpression(state, exp) : "nil"};\n`;
		result += state.indent + `done = false;\n`;
		state.popIndent();
		result += state.indent + `})`;
		return result;
	} else {
		/* istanbul ignore next */
		throw new TranspilerError(`Bad expression! (${node.getKindName()})`, node, TranspilerErrorType.BadExpression);
	}
}

export function transpileExpressionStatement(state: TranspilerState, node: ts.ExpressionStatement) {
	// big set of rules for expression statements
	const expression = node.getExpression();

	if (ts.TypeGuards.isCallExpression(expression)) {
		return state.indent + transpileCallExpression(state, expression, true) + ";\n";
	}

	if (
		!ts.TypeGuards.isNewExpression(expression) &&
		!ts.TypeGuards.isAwaitExpression(expression) &&
		!ts.TypeGuards.isPostfixUnaryExpression(expression) &&
		!(
			ts.TypeGuards.isPrefixUnaryExpression(expression) &&
			(expression.getOperatorToken() === ts.SyntaxKind.PlusPlusToken ||
				expression.getOperatorToken() === ts.SyntaxKind.MinusMinusToken)
		) &&
		!(ts.TypeGuards.isBinaryExpression(expression) && isSetToken(expression.getOperatorToken().getKind())) &&
		!ts.TypeGuards.isYieldExpression(expression)
	) {
		const expStr = transpileExpression(state, expression);
		return state.indent + `local _ = ${expStr};\n`;
	}
	return state.indent + transpileExpression(state, expression) + ";\n";
}

export function expressionModifiesVariable(
	node: ts.Node<ts.ts.Node>,
	lhs?: ts.Identifier,
): node is ts.BinaryExpression | ts.PrefixUnaryExpression | ts.PostfixUnaryExpression {
	const modifiedVars = getModifiedVariablesInExpression(node);

	if (lhs) {
		return modifiedVars
			? modifiedVars.some(modifiedVar => isIdentifierWhoseDefinitionMatchesNode(modifiedVar, lhs))
			: false;
	} else {
		return modifiedVars ? true : false;
	}
}

export function getModifiedVariablesInExpression(expression: ts.Node<ts.ts.Node>) {
	return [expression, ...expression.getDescendants()]
		.map(node => {
			if (
				ts.TypeGuards.isPostfixUnaryExpression(node) ||
				(ts.TypeGuards.isPrefixUnaryExpression(node) &&
					(node.getOperatorToken() === ts.SyntaxKind.PlusPlusToken ||
						node.getOperatorToken() === ts.SyntaxKind.MinusMinusToken))
			) {
				return node.getOperand();
			} else if (ts.TypeGuards.isBinaryExpression(node) && isSetToken(node.getOperatorToken().getKind())) {
				return node.getLeft();
			}
		})
		.filter((exp): exp is ts.Expression => exp !== undefined);
}

export function getAccessedVariablesInExpression(expression: ts.Node<ts.ts.Node>) {
	return [expression, ...expression.getDescendants()].filter(node => {
		console.log(ts.TypeGuards.isExpression(node), node.getKindName(), node.getText());
		return (
			!new Set(getModifiedVariablesInExpression(node)).has(node as ts.Expression) &&
			ts.TypeGuards.isIdentifier(node)
		);
	});
}

export function appendDeclarationIfMissing(possibleExpressionStatement: ts.Node, transpiledNode: string) {
	if (ts.TypeGuards.isExpressionStatement(possibleExpressionStatement)) {
		return "local _ = " + transpiledNode;
	} else {
		return transpiledNode;
	}
}

export function placeIncrementorInStatementIfExpression(
	state: TranspilerState,
	incrementor: ts.Expression<ts.ts.Expression>,
	incrementorStr: string,
) {
	if (ts.TypeGuards.isExpression(incrementor)) {
		if (
			!ts.TypeGuards.isCallExpression(incrementor) &&
			!expressionModifiesVariable(incrementor) &&
			!ts.TypeGuards.isVariableDeclarationList(incrementor)
		) {
			incrementorStr = `local _ = ` + incrementorStr;
		}
	}
	return incrementorStr;
}
