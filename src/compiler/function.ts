import * as ts from "ts-morph";
import {
	checkReserved,
	checkReturnsNonAny,
	compileBlock,
	compileCallExpression,
	compileExpression,
	compileStatement,
	getParameterData,
} from ".";
import { CompilerState } from "../CompilerState";
import { CompilerError, CompilerErrorType } from "../errors/CompilerError";
import { HasParameters } from "../types";
import { isIterableIterator, isTupleType, shouldHoist } from "../typeUtilities";
import { getNonNullUnParenthesizedExpressionDownwards } from "../utility";

export function getFirstMemberWithParameters(nodes: Array<ts.Node<ts.ts.Node>>): HasParameters | undefined {
	for (const node of nodes) {
		if (
			ts.TypeGuards.isFunctionExpression(node) ||
			ts.TypeGuards.isArrowFunction(node) ||
			ts.TypeGuards.isFunctionDeclaration(node) ||
			ts.TypeGuards.isConstructorDeclaration(node) ||
			ts.TypeGuards.isMethodDeclaration(node) ||
			ts.TypeGuards.isGetAccessorDeclaration(node) ||
			ts.TypeGuards.isSetAccessorDeclaration(node)
		) {
			return node;
		}
	}
	return undefined;
}

function getReturnStrFromExpression(state: CompilerState, exp: ts.Expression, func?: HasParameters) {
	exp = getNonNullUnParenthesizedExpressionDownwards(exp);

	if (func && isTupleType(func.getReturnType())) {
		if (ts.TypeGuards.isArrayLiteralExpression(exp)) {
			let expStr = compileExpression(state, exp);
			expStr = expStr.substr(2, expStr.length - 4);
			return `return ${expStr};`;
		} else if (ts.TypeGuards.isCallExpression(exp) && isTupleType(exp.getReturnType())) {
			const expStr = compileCallExpression(state, exp, true);
			return `return ${expStr};`;
		} else {
			const expStr = compileExpression(state, exp);
			return `return unpack(${expStr});`;
		}
	}
	{
		state.declarationContext.set(exp, {
			isIdentifier: false,
			set: "return",
		});
		const expStr = compileExpression(state, exp);
		return state.declarationContext.delete(exp) && `return ${expStr};`;
	}
}

export function compileReturnStatement(state: CompilerState, node: ts.ReturnStatement) {
	const exp = node.getExpression();
	if (exp) {
		state.enterPrecedingStatementContext();
		const returnStr = getReturnStrFromExpression(state, exp, getFirstMemberWithParameters(node.getAncestors()));
		return state.exitPrecedingStatementContextAndJoin() + (returnStr ? state.indent + returnStr + "\n" : "");
	} else {
		return state.indent + `return nil;\n`;
	}
}

function compileFunctionBody(state: CompilerState, body: ts.Node, node: HasParameters, initializers: Array<string>) {
	const isBlock = ts.TypeGuards.isBlock(body);
	const isExpression = ts.TypeGuards.isExpression(body);
	let result = "";
	if (isBlock || isExpression) {
		result += "\n";
		state.pushIndent();
		initializers.forEach(initializer => (result += state.indent + initializer + "\n"));
		if (isBlock) {
			result += compileBlock(state, body as ts.Block);
		} else {
			state.enterPrecedingStatementContext();
			const returnStr = getReturnStrFromExpression(state, body as ts.Expression, node);
			result += state.exitPrecedingStatementContextAndJoin() + (returnStr ? state.indent + returnStr + "\n" : "");
		}
		state.popIndent();
		result += state.indent;
	} else {
		/* istanbul ignore next */
		throw new CompilerError(`Bad function body (${body.getKindName()})`, node, CompilerErrorType.BadFunctionBody);
	}
	return result;
}

export function isFunctionExpressionMethod(node: ts.FunctionExpression) {
	const parent = node.getParent();
	return ts.TypeGuards.isPropertyAssignment(parent) && ts.TypeGuards.isObjectLiteralExpression(parent.getParent());
}

export function isMethodDeclaration(node: ts.Node<ts.ts.Node>): node is ts.MethodDeclaration | ts.FunctionExpression {
	return (
		ts.TypeGuards.isMethodDeclaration(node) ||
		(ts.TypeGuards.isFunctionExpression(node) && isFunctionExpressionMethod(node))
	);
}

function compileFunction(state: CompilerState, node: HasParameters, name: string, body: ts.Node<ts.ts.Node>) {
	state.pushIdStack();
	const paramNames = new Array<string>();
	const initializers = new Array<string>();

	getParameterData(state, paramNames, initializers, node);
	checkReturnsNonAny(node);

	if (
		isMethodDeclaration(node) ||
		ts.TypeGuards.isGetAccessorDeclaration(node) ||
		ts.TypeGuards.isSetAccessorDeclaration(node)
	) {
		giveInitialSelfParameter(node, paramNames);
	}

	let result: string;
	let backWrap = "";

	let prefix = "";
	if (ts.TypeGuards.isFunctionDeclaration(node)) {
		const nameNode = node.getNameNode();
		if (nameNode && shouldHoist(node, nameNode)) {
			state.pushHoistStack(name);
		} else {
			prefix = "local ";
		}
	}

	if (name) {
		result = state.indent + prefix + name + " = ";
		backWrap = ";\n";
	} else {
		result = "";
	}

	let isGenerator = false;

	if (
		!ts.TypeGuards.isGetAccessorDeclaration(node) &&
		!ts.TypeGuards.isSetAccessorDeclaration(node) &&
		!ts.TypeGuards.isConstructorDeclaration(node)
	) {
		if (node.isAsync()) {
			state.usesTSLibrary = true;
			result += "TS.async(";
			backWrap = ")" + backWrap;
		}
		isGenerator = !ts.TypeGuards.isArrowFunction(node) && node.isGenerator();
	}

	result += "function(" + paramNames.join(", ") + ")";

	if (isGenerator) {
		// will error if IterableIterator is nullable
		isIterableIterator(node.getReturnType(), node);
		result += "\n";
		state.pushIndent();
		result += state.indent + `return {\n`;
		state.pushIndent();
		result += state.indent + `next = coroutine.wrap(function()`;
		result += compileFunctionBody(state, body, node, initializers);
		result += `\twhile true do coroutine.yield({ done = true }) end;\n`;
		result += state.indent + `end);\n`;
		state.popIndent();
		result += state.indent + `};\n`;
		state.popIndent();
		result += state.indent;
	} else {
		result += compileFunctionBody(state, body, node, initializers);
	}
	state.popIdStack();
	return result + "end" + backWrap;
}

function giveInitialSelfParameter(node: HasParameters, paramNames: Array<string>) {
	const parameters = node.getParameters();
	let replacedThis = false;

	if (parameters.length > 0) {
		const child = parameters[0].getFirstChildByKind(ts.SyntaxKind.Identifier);
		const classParent =
			node.getFirstAncestorByKind(ts.SyntaxKind.ClassDeclaration) ||
			node.getFirstAncestorByKind(ts.SyntaxKind.ClassExpression);
		if (
			classParent &&
			child &&
			child.getText() === "this" &&
			(child.getType().getText() === "this" || child.getType() === classParent.getType())
		) {
			paramNames[0] = "self";
			replacedThis = true;
		}
	}

	if (!replacedThis) {
		const thisParam = node.getParameter("this");
		if (!thisParam || thisParam.getType().getText() !== "void") {
			paramNames.unshift("self");
		}
	}
}

export function compileFunctionDeclaration(state: CompilerState, node: ts.FunctionDeclaration) {
	const body = node.getBody();
	let name = node.getName();

	if (name) {
		checkReserved(name, node, true);
	} else {
		name = state.getNewId();
	}

	if (body) {
		state.pushExport(name, node);
		return compileFunction(state, node, name, body);
	} else {
		return "";
	}
}

export function compileMethodDeclaration(state: CompilerState, node: ts.MethodDeclaration) {
	const nameNode: ts.PropertyName = node.getNameNode();
	let name: string;

	if (ts.TypeGuards.isComputedPropertyName(nameNode)) {
		name = `[${compileExpression(state, nameNode.getExpression())}]`;
	} else {
		name = compileExpression(state, nameNode);
		checkReserved(name, node);
	}

	return compileFunction(state, node, name, node.getBodyOrThrow());
}

function containsSuperExpression(child?: ts.Statement<ts.ts.Statement>) {
	if (child && ts.TypeGuards.isExpressionStatement(child)) {
		const exp = child.getExpression();
		if (ts.TypeGuards.isCallExpression(exp)) {
			const superExp = exp.getExpression();
			if (ts.TypeGuards.isSuperExpression(superExp)) {
				return true;
			}
		}
	}
	return false;
}

export function compileConstructorDeclaration(
	state: CompilerState,
	className: string,
	node?: ts.ConstructorDeclaration,
	extraInitializers?: Array<string>,
	hasSuper?: boolean,
) {
	const paramNames = new Array<string>();
	paramNames.push("self");
	const initializers = new Array<string>();
	const defaults = new Array<string>();

	state.pushIdStack();
	if (node) {
		getParameterData(state, paramNames, initializers, node, defaults);
	} else {
		paramNames.push("...");
	}
	const paramStr = paramNames.join(", ");

	let result = "";
	result += state.indent + `${className}.constructor = function(${paramStr})\n`;
	state.pushIndent();

	if (node) {
		const body = node.getBodyOrThrow();
		if (ts.TypeGuards.isBlock(body)) {
			defaults.forEach(initializer => (result += state.indent + initializer + "\n"));

			const bodyStatements = body.getStatements();
			let k = 0;

			if (containsSuperExpression(bodyStatements[k])) {
				result += compileStatement(state, bodyStatements[k++]);
			}

			initializers.forEach(initializer => (result += state.indent + initializer + "\n"));

			if (extraInitializers) {
				extraInitializers.forEach(initializer => (result += initializer));
			}

			for (; k < bodyStatements.length; ++k) {
				result += compileStatement(state, bodyStatements[k]);
			}

			const returnStatement = node.getStatementByKind(ts.SyntaxKind.ReturnStatement);

			if (returnStatement) {
				throw new CompilerError(
					`Cannot use return statement in constructor for ${className}`,
					returnStatement,
					CompilerErrorType.NoConstructorReturn,
				);
			}
		}
	} else {
		if (hasSuper) {
			result += state.indent + `super.constructor(self, ...);\n`;
		}
		if (extraInitializers) {
			extraInitializers.forEach(initializer => (result += initializer));
		}
	}
	result += state.indent + "return self;\n";
	state.popIndent();
	state.popIdStack();
	result += state.indent + "end;\n";
	return result;
}

export function compileAccessorDeclaration(
	state: CompilerState,
	node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
	name: string,
) {
	const body = node.getBody();
	if (!body) {
		return "";
	}
	return compileFunction(state, node, name, body);
}

export function compileFunctionExpression(state: CompilerState, node: ts.FunctionExpression | ts.ArrowFunction) {
	const potentialNameNode = node.getChildAtIndex(1);

	if (
		ts.TypeGuards.isFunctionExpression(node) &&
		ts.TypeGuards.isIdentifier(potentialNameNode) &&
		potentialNameNode.findReferences()[0].getReferences().length > 1
	) {
		const name = compileExpression(state, potentialNameNode);
		const id = state.pushPrecedingStatementToNewId(node, "");
		state.pushPrecedingStatements(node, state.indent + `do\n`);
		state.pushIndent();
		state.pushPrecedingStatements(node, state.indent + `local ${name};\n`);
		state.pushPrecedingStatements(node, compileFunction(state, node, `${name}`, node.getBody()));
		state.pushPrecedingStatements(node, state.indent + `${id} = ${name};\n`);
		state.popIndent();
		state.pushPrecedingStatements(node, state.indent + `end;\n`);
		// this should not be classified as isPushed.
		return id;
	} else {
		return compileFunction(state, node, "", node.getBody());
	}
}
