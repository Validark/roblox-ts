import * as ts from "ts-morph";
import { transpileExpression } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { isNumberType, isStringType, isTupleReturnType } from "../typeUtilities";
import { getBindingData } from "./binding";
import { transpileCallExpression } from "./call";
import { transpileIdentifier } from "./identifier";
import { checkNonAny } from "./security";

function getLuaBarExpression(state: TranspilerState, node: ts.BinaryExpression, lhsStr: string, rhsStr: string) {
	state.usesTSLibrary = true;
	const rhs = node.getRight();
	if (ts.TypeGuards.isNumericLiteral(rhs) && rhs.getLiteralValue() === 0) {
		return `TS.round(${lhsStr})`;
	} else {
		return `TS.bor(${lhsStr}, ${rhsStr})`;
	}
}

function getLuaBitExpression(state: TranspilerState, lhsStr: string, rhsStr: string, name: string) {
	state.usesTSLibrary = true;
	return `TS.b${name}(${lhsStr}, ${rhsStr})`;
}

function getLuaAddExpression(node: ts.BinaryExpression, lhsStr: string, rhsStr: string, wrap = false) {
	if (wrap) {
		rhsStr = `(${rhsStr})`;
	}
	const leftType = node.getLeft().getType();
	const rightType = node.getRight().getType();
	if (isStringType(leftType) || isStringType(rightType)) {
		return `(${lhsStr}) .. ${rhsStr}`;
	} else if (isNumberType(leftType) && isNumberType(rightType)) {
		return `${lhsStr} + ${rhsStr}`;
	} else {
		/* istanbul ignore next */
		throw new TranspilerError(
			`Unexpected types for addition: ${leftType.getText()} + ${rightType.getText()}`,
			node,
			TranspilerErrorType.BadAddition,
		);
	}
}

export function isSetToken(opKind: ts.ts.SyntaxKind) {
	return (
		opKind === ts.SyntaxKind.EqualsToken ||
		opKind === ts.SyntaxKind.BarEqualsToken ||
		opKind === ts.SyntaxKind.AmpersandEqualsToken ||
		opKind === ts.SyntaxKind.CaretEqualsToken ||
		opKind === ts.SyntaxKind.LessThanLessThanEqualsToken ||
		opKind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
		opKind === ts.SyntaxKind.PlusEqualsToken ||
		opKind === ts.SyntaxKind.MinusEqualsToken ||
		opKind === ts.SyntaxKind.AsteriskEqualsToken ||
		opKind === ts.SyntaxKind.SlashEqualsToken ||
		opKind === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
		opKind === ts.SyntaxKind.PercentEqualsToken
	);
}

function transpileArrayElement(
	state: TranspilerState,
	element: ts.Expression | ts.BindingElement | ts.BindingName | ts.OmittedExpression,
): string {
	if (ts.TypeGuards.isIdentifier(element)) {
		return transpileIdentifier(state, element);
	} else if (ts.TypeGuards.isBindingElement(element)) {
		return transpileArrayElement(state, element.getNameNode());
	} else if (ts.TypeGuards.isOmittedExpression(element)) {
		return "_";
	} else {
		throw new TranspilerError(
			"Unable to transpile arrayExpression of type " + element.getKindName(),
			element,
			TranspilerErrorType.UnexpectedBindingPattern,
		);
	}
}

function getElementNames(state: TranspilerState, lhs: ts.Node) {
	// TypeScript REALLY doesn't want us to combine these into one.
	if (ts.TypeGuards.isArrayBindingPattern(lhs)) {
		return lhs.getElements().map(element => transpileArrayElement(state, element));
	} else if (ts.TypeGuards.isArrayLiteralExpression(lhs)) {
		return lhs.getElements().map(element => transpileArrayElement(state, element));
	} else if (ts.TypeGuards.isObjectBindingPattern(lhs)) {
		return lhs.getElements().map(element => transpileArrayElement(state, element));
	} else {
		throw new TranspilerError(
			"Unable to transpile arrayElement of type " + lhs.getKindName(),
			lhs,
			TranspilerErrorType.UnexpectedBindingPattern,
		);
	}
}

export function transpileArrayEqualsExpression(
	state: TranspilerState,
	lhs: ts.ArrayBindingPattern | ts.ArrayLiteralExpression | ts.ObjectBindingPattern,
	rhs: ts.Expression,
	shouldLocalize = false,
	names = new Array<string>(),
	values = new Array<string>(),
	isExported = false,
	decKind = ts.VariableDeclarationKind.Let,
) {
	const prestatement = shouldLocalize ? "local " : "";
	const exportContext = isExported ? state.getExportContextName(lhs) + "." : "";
	getElementNames(state, lhs).forEach(a => names.push(exportContext + a));

	const preStatements = new Array<string>();
	const postStatements = new Array<string>();

	const myElements = lhs.getFirstChildByKindOrThrow(ts.SyntaxKind.SyntaxList).getChildren();
	const isFlatBinding = myElements
		.filter(v => ts.TypeGuards.isBindingElement(v))
		.every(bindingElement => ts.TypeGuards.isIdentifier(bindingElement.getChildAtIndex(0)));

	// is optimizable expression
	if (isFlatBinding && rhs && ts.TypeGuards.isCallExpression(rhs) && isTupleReturnType(rhs)) {
		for (const element of myElements) {
			// console.log(".", element.getKindName(), element.getText());
			if (ts.TypeGuards.isBindingElement(element)) {
				const nameNode = element.getNameNode();
				if (ts.TypeGuards.isIdentifier(nameNode)) {
					names.push(transpileExpression(state, nameNode));
				}
			} else if (ts.TypeGuards.isOmittedExpression(element)) {
				names.push("_");
			}
		}
		const rhsStr = transpileCallExpression(state, rhs, true);
		// console.log("rhs:", rhsStr);
		values.push(rhsStr);
		const grandParent = lhs
			.getParent()!
			.getParent()!
			.getParent()!;

		if (isExported && decKind === ts.VariableDeclarationKind.Let) {
			return [state.indent + `${names.join(", ")} = ${values.join(", ")};\n`, rhsStr];
		} else {
			if (isExported && ts.TypeGuards.isVariableStatement(grandParent)) {
				names.forEach(name => state.pushExport(name, grandParent));
			}
			return [state.indent + `${prestatement}${names.join(", ")} = ${values.join(", ")};\n`, rhsStr];
		}
	} else {
		let rootId: string;
		if (ts.TypeGuards.isIdentifier(rhs)) {
			rootId = transpileExpression(state, rhs);
		} else {
			rootId = state.getNewId();
			preStatements.push(`local ${rootId} = ${transpileExpression(state, rhs)};`);
		}
		getBindingData(state, names, values, preStatements, postStatements, lhs, rootId);

		let result = "";
		preStatements.forEach(statementStr => (result += state.indent + statementStr + "\n"));
		result += state.indent + (shouldLocalize ? "local " : "") + `${names.join(", ")} = ${values.join(", ")};\n`;
		postStatements.forEach(statementStr => (result += state.indent + statementStr + "\n"));

		if (names.length === 0) {
			throw new TranspilerError(
				"Invalid destructuring expression, cannot transpile expressions of the form: [] = data",
				lhs,
				TranspilerErrorType.InvalidArraySetExpression,
			);
		}
		return [result, rootId];
	}
}

export function transpileBinaryExpression(state: TranspilerState, node: ts.BinaryExpression) {
	const opToken = node.getOperatorToken();
	const opKind = opToken.getKind();

	const lhs = node.getLeft();
	const rhs = node.getRight();
	let lhsStr: string;
	const statements = new Array<string>();

	if (opKind !== ts.SyntaxKind.EqualsToken) {
		checkNonAny(lhs);
		checkNonAny(rhs);
	}

	// binding patterns
	if (ts.TypeGuards.isArrayLiteralExpression(lhs)) {
		let result = "";
		const parentKind = node.getParentOrThrow().getKind();
		const useIIFE = parentKind !== ts.SyntaxKind.ExpressionStatement && parentKind !== ts.SyntaxKind.ForStatement;

		if (useIIFE) {
			result += `(function()\n`;
			state.pushIndent();
		}

		const [expStr, rootId] = transpileArrayEqualsExpression(state, lhs, rhs);
		result += expStr;

		if (useIIFE) {
			result += state.indent + `return ${rootId};\n`;
			state.popIndent();
			result += `end)()`;
		}

		return result;
	}

	const rhsStr = transpileExpression(state, rhs);

	if (isSetToken(opKind)) {
		if (ts.TypeGuards.isPropertyAccessExpression(lhs) && opKind !== ts.SyntaxKind.EqualsToken) {
			const expression = lhs.getExpression();
			const opExpStr = transpileExpression(state, expression);
			const propertyStr = lhs.getName();
			const id = state.getNewId();
			statements.push(`local ${id} = ${opExpStr}`);
			lhsStr = `${id}.${propertyStr}`;
		} else {
			lhsStr = transpileExpression(state, lhs);
		}

		if (opKind === ts.SyntaxKind.EqualsToken) {
			statements.push(`${lhsStr} = ${rhsStr}`);
		} else if (opKind === ts.SyntaxKind.BarEqualsToken) {
			const barExpStr = getLuaBarExpression(state, node, lhsStr, rhsStr);
			statements.push(`${lhsStr} = ${barExpStr}`);
		} else if (opKind === ts.SyntaxKind.AmpersandEqualsToken) {
			const ampersandExpStr = getLuaBitExpression(state, lhsStr, rhsStr, "and");
			statements.push(`${lhsStr} = ${ampersandExpStr}`);
		} else if (opKind === ts.SyntaxKind.CaretEqualsToken) {
			const caretExpStr = getLuaBitExpression(state, lhsStr, rhsStr, "xor");
			statements.push(`${lhsStr} = ${caretExpStr}`);
		} else if (opKind === ts.SyntaxKind.LessThanLessThanEqualsToken) {
			const lhsExpStr = getLuaBitExpression(state, lhsStr, rhsStr, "lsh");
			statements.push(`${lhsStr} = ${lhsExpStr}`);
		} else if (opKind === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken) {
			const rhsExpStr = getLuaBitExpression(state, lhsStr, rhsStr, "rsh");
			statements.push(`${lhsStr} = ${rhsExpStr}`);
		} else if (opKind === ts.SyntaxKind.PlusEqualsToken) {
			const addExpStr = getLuaAddExpression(node, lhsStr, rhsStr, true);
			statements.push(`${lhsStr} = ${addExpStr}`);
		} else if (opKind === ts.SyntaxKind.MinusEqualsToken) {
			statements.push(`${lhsStr} = ${lhsStr} - (${rhsStr})`);
		} else if (opKind === ts.SyntaxKind.AsteriskEqualsToken) {
			statements.push(`${lhsStr} = ${lhsStr} * (${rhsStr})`);
		} else if (opKind === ts.SyntaxKind.SlashEqualsToken) {
			statements.push(`${lhsStr} = ${lhsStr} / (${rhsStr})`);
		} else if (opKind === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
			statements.push(`${lhsStr} = ${lhsStr} ^ (${rhsStr})`);
		} else if (opKind === ts.SyntaxKind.PercentEqualsToken) {
			statements.push(`${lhsStr} = ${lhsStr} % (${rhsStr})`);
		}

		const parentKind = node.getParentOrThrow().getKind();
		if (parentKind === ts.SyntaxKind.ExpressionStatement || parentKind === ts.SyntaxKind.ForStatement) {
			return statements.join("; ");
		} else {
			const statementsStr = statements.join("; ");
			return `(function() ${statementsStr}; return ${lhsStr}; end)()`;
		}
	} else {
		lhsStr = transpileExpression(state, lhs);
	}

	if (opKind === ts.SyntaxKind.EqualsEqualsToken) {
		throw new TranspilerError(
			"operator '==' is not supported! Use '===' instead.",
			opToken,
			TranspilerErrorType.NoEqualsEquals,
		);
	} else if (opKind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
		return `${lhsStr} == ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.ExclamationEqualsToken) {
		throw new TranspilerError(
			"operator '!=' is not supported! Use '!==' instead.",
			opToken,
			TranspilerErrorType.NoExclamationEquals,
		);
	} else if (opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
		return `${lhsStr} ~= ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.BarToken) {
		return getLuaBarExpression(state, node, lhsStr, rhsStr);
	} else if (opKind === ts.SyntaxKind.AmpersandToken) {
		return getLuaBitExpression(state, lhsStr, rhsStr, "and");
	} else if (opKind === ts.SyntaxKind.CaretToken) {
		return getLuaBitExpression(state, lhsStr, rhsStr, "xor");
	} else if (opKind === ts.SyntaxKind.LessThanLessThanToken) {
		return getLuaBitExpression(state, lhsStr, rhsStr, "lsh");
	} else if (opKind === ts.SyntaxKind.GreaterThanGreaterThanToken) {
		return getLuaBitExpression(state, lhsStr, rhsStr, "rsh");
	} else if (opKind === ts.SyntaxKind.PlusToken) {
		return getLuaAddExpression(node, lhsStr, rhsStr);
	} else if (opKind === ts.SyntaxKind.MinusToken) {
		return `${lhsStr} - ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.AsteriskToken) {
		return `${lhsStr} * ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.SlashToken) {
		return `${lhsStr} / ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.AsteriskAsteriskToken) {
		return `${lhsStr} ^ ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.InKeyword) {
		// doesn't need parenthesis because In is restrictive
		return `${rhsStr}[${lhsStr}] ~= nil`;
	} else if (opKind === ts.SyntaxKind.AmpersandAmpersandToken) {
		return `${lhsStr} and ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.BarBarToken) {
		return `${lhsStr} or ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.GreaterThanToken) {
		return `${lhsStr} > ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.LessThanToken) {
		return `${lhsStr} < ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.GreaterThanEqualsToken) {
		return `${lhsStr} >= ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.LessThanEqualsToken) {
		return `${lhsStr} <= ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.PercentToken) {
		return `${lhsStr} % ${rhsStr}`;
	} else if (opKind === ts.SyntaxKind.InstanceOfKeyword) {
		state.usesTSLibrary = true;
		return `TS.instanceof(${lhsStr}, ${rhsStr})`;
	} else {
		/* istanbul ignore next */
		throw new TranspilerError(
			`Bad binary expression! (${node.getOperatorToken().getKindName()})`,
			opToken,
			TranspilerErrorType.BadBinaryExpression,
		);
	}
}
