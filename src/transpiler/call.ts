import * as ts from "ts-morph";
import { checkApiAccess, checkNonAny, transpileExpression } from ".";
import { TranspilerError, TranspilerErrorType } from "../errors/TranspilerError";
import { TranspilerState } from "../TranspilerState";
import { isArrayType, isStringType, isTupleReturnTypeCall, typeConstraint } from "../typeUtilities";
import { appendDeclarationIfMissing } from "./expression";

const STRING_MACRO_METHODS = [
	"byte",
	"find",
	"format",
	"gmatch",
	"gsub",
	"len",
	"lower",
	"match",
	"rep",
	"reverse",
	"sub",
	"upper",
];

function shouldWrapExpression(state: TranspilerState, subExp: ts.Node, strict: boolean) {
	return (
		!ts.TypeGuards.isIdentifier(subExp) &&
		!ts.TypeGuards.isElementAccessExpression(subExp) &&
		(strict || (!ts.TypeGuards.isCallExpression(subExp) && !ts.TypeGuards.isPropertyAccessExpression(subExp)))
	);
}

function wrapExpressionIfNeeded(
	state: TranspilerState,
	subExp: ts.LeftHandSideExpression<ts.ts.LeftHandSideExpression>,
	strict: boolean = false,
) {
	// If we transpile to a method call, we might need to wrap in parenthesis
	// We are going to wrap in parenthesis just to be safe,
	// unless it's a CallExpression, Identifier, ElementAccessExpression, or PropertyAccessExpression

	const accessPath = transpileExpression(state, subExp);

	if (shouldWrapExpression(state, subExp, strict)) {
		return `(${accessPath})`;
	} else {
		return accessPath;
	}
}

/** Skips over Null expressions */
export function getNonNull<T extends ts.Node>(exp: T): T {
	while (ts.TypeGuards.isNonNullExpression(exp)) {
		exp = (exp.getExpression() as unknown) as T;
	}

	return exp;
}

function getLeftHandSideParent(subExp: ts.Node, climb: number = 3) {
	let exp = subExp;

	for (let _ = 0; _ < climb; _++) {
		exp = getNonNull(exp.getParent());
	}

	return exp;
}

function transpileMapElement(state: TranspilerState, argumentList: Array<ts.Node>) {
	const [key, value] = compileCallArguments(state, argumentList);
	return state.indent + `[${key}] = ${value};\n`;
}

function transpileSetElement(state: TranspilerState, argument: ts.Node) {
	const [key] = compileCallArguments(state, [argument]);
	return state.indent + `[${key}] = true;\n`;
}

function transpileSetArrayLiteralParameter(state: TranspilerState, elements: Array<ts.Expression>) {
	return elements.reduce((a, x) => a + transpileSetElement(state, x), "");
}

function transpileMapArrayLiteralParameter(state: TranspilerState, elements: Array<ts.Expression>) {
	return elements.reduce((a, x) => {
		if (ts.TypeGuards.isArrayLiteralExpression(x)) {
			return a + transpileMapElement(state, x.getElements());
		} else {
			throw new TranspilerError(
				"Bad arguments to Map constructor",
				x,
				TranspilerErrorType.BadBuiltinConstructorCall,
			);
		}
	}, "");
}

export const literalParameterTranspileFunctions = new Map<
	"set" | "map",
	(state: TranspilerState, elements: Array<ts.Expression>) => string
>([["set", transpileSetArrayLiteralParameter], ["map", transpileMapArrayLiteralParameter]]);

function transpileLiterally(
	state: TranspilerState,
	params: Array<ts.Node>,
	subExp: ts.LeftHandSideExpression<ts.ts.LeftHandSideExpression>,
	funcName: "set" | "add",
	transpileParamFunc: (state: TranspilerState, argumentList: Array<ts.Node>) => string,
) {
	const leftHandSideParent = getLeftHandSideParent(subExp);
	if (!getIsExpressionStatement(subExp, leftHandSideParent)) {
		let child: ts.Node = subExp;
		const extraParams = new Array<Array<ts.Node>>();

		// Walk down the tree, making sure all descendants of subExp are .set() calls
		while (ts.TypeGuards.isCallExpression(child)) {
			extraParams.push(child.getArguments());
			child = getNonNull(child.getChildAtIndex(0));

			if (ts.TypeGuards.isPropertyAccessExpression(child) && child.getName() === funcName) {
				child = getNonNull(child.getChildAtIndex(0));
			} else {
				break;
			}
		}

		// if all set calls are on a newExpression
		if (child && ts.TypeGuards.isNewExpression(child)) {
			let result = "{\n";
			state.pushIndent();

			const newArguments = child.getArguments();
			const firstArgument = newArguments[0];

			if (newArguments.length === 1 && ts.TypeGuards.isArrayLiteralExpression(firstArgument)) {
				const elements = firstArgument.getElements();
				result += literalParameterTranspileFunctions.get(funcName === "add" ? "set" : "map")!(state, elements);
			} else if (newArguments.length !== 0) {
				state.popIndent();
				return undefined;
			}

			result = extraParams.reduceRight((a, x) => a + transpileParamFunc(state, x), result);
			result += transpileParamFunc(state, params);
			state.popIndent();
			result += state.indent + "}";
			return appendDeclarationIfMissing(leftHandSideParent, result);
		}
	}
}

function getIsExpressionStatement(subExp: ts.LeftHandSideExpression<ts.ts.LeftHandSideExpression>, parent: ts.Node) {
	return !ts.TypeGuards.isNewExpression(subExp) && ts.TypeGuards.isExpressionStatement(parent);
}

function getPropertyCallParentIsExpressionStatement(subExp: ts.LeftHandSideExpression<ts.ts.LeftHandSideExpression>) {
	return getIsExpressionStatement(subExp, getLeftHandSideParent(subExp));
}

type SimpleReplaceFunction = (
	accessPath: string,
	params: Array<ts.Node>,
	state: TranspilerState,
	subExp: ts.LeftHandSideExpression<ts.ts.LeftHandSideExpression>,
) => string | undefined;

type ReplaceFunction = (
	params: Array<ts.Node>,
	state: TranspilerState,
	subExp: ts.LeftHandSideExpression<ts.ts.LeftHandSideExpression>,
) => string | undefined;

type ReplaceMap = ReadonlyMap<string, ReplaceFunction>;

function wrapExpFunc(replacer: (accessPath: string) => string): ReplaceFunction {
	return (params, state, subExp) => replacer(wrapExpressionIfNeeded(state, subExp));
}

function accessPathWrap(replacer: SimpleReplaceFunction): ReplaceFunction {
	return (params, state, subExp) => replacer(transpileExpression(state, subExp), params, state, subExp);
}

const STRING_REPLACE_METHODS: ReplaceMap = new Map<string, ReplaceFunction>()
	.set("trim", wrapExpFunc(accessPath => `${accessPath}:match("^%s*(.-)%s*$")`))
	.set("trimLeft", wrapExpFunc(accessPath => `${accessPath}:match("^%s*(.-)$")`))
	.set("trimRight", wrapExpFunc(accessPath => `${accessPath}:match("^(.-)%s*$")`))
	.set("split", (params, state, subExp) => {
		return `string.split(${wrapExpressionIfNeeded(state, subExp)}, ${compileCallArguments(state, params)[0]})`;
	});

(STRING_REPLACE_METHODS as Map<string, ReplaceFunction>).set("trimStart", STRING_REPLACE_METHODS.get("trimLeft")!);
(STRING_REPLACE_METHODS as Map<string, ReplaceFunction>).set("trimEnd", STRING_REPLACE_METHODS.get("trimRight")!);

const ARRAY_REPLACE_METHODS: ReplaceMap = new Map<string, ReplaceFunction>()
	.set("pop", accessPathWrap(accessPath => `table.remove(${accessPath})`))
	.set("shift", accessPathWrap(accessPath => `table.remove(${accessPath}, 1)`))

	.set("join", (params, state, subExp) => {
		const arrayType = subExp.getType().getArrayType()!;
		const validTypes = arrayType.isUnion() ? arrayType.getUnionTypes() : [arrayType];

		if (validTypes.every(validType => validType.isNumber() || validType.isString())) {
			const paramStr = params[0] ? compileCallArguments(state, params)[0] : `", "`;
			const accessPath = transpileExpression(state, subExp);
			return `table.concat(${accessPath}, ${paramStr})`;
		}
	})

	.set("push", (params, state, subExp) => {
		const length = params.length;
		if (length === 1 && getPropertyCallParentIsExpressionStatement(subExp)) {
			const accessPath = transpileExpression(state, subExp);
			const [paramStr] = compileCallArguments(state, params);

			if (ts.TypeGuards.isIdentifier(subExp)) {
				return `${accessPath}[#${accessPath} + 1] = ${paramStr}`;
			} else {
				return `table.insert(${accessPath}, ${paramStr})`;
			}
		}
	})

	.set("unshift", (params, state, subExp) => {
		const length = params.length;
		if (length === 1 && getPropertyCallParentIsExpressionStatement(subExp)) {
			const accessPath = transpileExpression(state, subExp);
			const [paramStr] = compileCallArguments(state, params);
			return `table.insert(${accessPath}, 1, ${paramStr})`;
		}
	})

	.set(
		"insert",
		accessPathWrap((accessPath, params, state) => {
			const [indexParamStr, valueParamStr] = compileCallArguments(state, params);
			return `table.insert(${accessPath}, ${indexParamStr} + 1, ${valueParamStr})`;
		}),
	)

	.set(
		"remove",
		accessPathWrap((accessPath, params, state) => {
			const [indexParamStr] = compileCallArguments(state, params);

			return `table.remove(${accessPath}, ${indexParamStr} + 1)`;
		}),
	)

	.set("isEmpty", (params, state, subExp) =>
		appendDeclarationIfMissing(
			getLeftHandSideParent(subExp),
			`(next(${transpileExpression(state, subExp)}) == nil)`,
		),
	);

const MAP_REPLACE_METHODS: ReplaceMap = new Map<string, ReplaceFunction>()
	.set("get", (params, state, subExp) => {
		const accessPath = wrapExpressionIfNeeded(state, subExp, true);
		const [key] = compileCallArguments(state, params);
		return appendDeclarationIfMissing(getLeftHandSideParent(subExp), `${accessPath}[${key}]`);
	})

	.set("set", (params, state, subExp) => {
		const literalResults = transpileLiterally(state, params, subExp, "set", (stately, argumentList) =>
			transpileMapElement(stately, argumentList),
		);
		if (literalResults) {
			return literalResults;
		} else {
			if (getPropertyCallParentIsExpressionStatement(subExp)) {
				const accessPath = wrapExpressionIfNeeded(state, subExp, true);
				const [key, value] = compileCallArguments(state, params);
				return `${accessPath}[${key}] = ${value}`;
			}
		}
	})

	.set("delete", (params, state, subExp) => {
		if (getPropertyCallParentIsExpressionStatement(subExp)) {
			const accessPath = wrapExpressionIfNeeded(state, subExp, true);
			const [key] = compileCallArguments(state, params);
			return `${accessPath}[${key}] = nil`;
		}
	})

	.set("has", (params, state, subExp) => {
		const accessPath = wrapExpressionIfNeeded(state, subExp, true);
		const [key] = compileCallArguments(state, params);
		return appendDeclarationIfMissing(getLeftHandSideParent(subExp), `(${accessPath}[${key}] ~= nil)`);
	})

	.set("isEmpty", (params, state, subExp) =>
		appendDeclarationIfMissing(
			getLeftHandSideParent(subExp),
			`(next(${transpileExpression(state, subExp)}) == nil)`,
		),
	);

const SET_REPLACE_METHODS: ReplaceMap = new Map<string, ReplaceFunction>()
	.set("add", (params, state, subExp) => {
		const literalResults = transpileLiterally(state, params, subExp, "add", (stately, argumentList) =>
			transpileSetElement(stately, argumentList[0]),
		);

		if (literalResults) {
			return literalResults;
		} else {
			if (getPropertyCallParentIsExpressionStatement(subExp)) {
				const accessPath = wrapExpressionIfNeeded(state, subExp, true);
				const [key] = compileCallArguments(state, params);
				return `${accessPath}[${key}] = true`;
			}
		}
	})

	.set("delete", (params, state, subExp) => {
		if (getPropertyCallParentIsExpressionStatement(subExp)) {
			const accessPath = wrapExpressionIfNeeded(state, subExp, true);
			const [key] = compileCallArguments(state, params);
			return `${accessPath}[${key}] = nil`;
		}
	})

	.set("has", (params, state, subExp) => {
		const accessPath = wrapExpressionIfNeeded(state, subExp, true);
		const [key] = compileCallArguments(state, params);
		return appendDeclarationIfMissing(getLeftHandSideParent(subExp), `(${accessPath}[${key}] == true)`);
	})

	.set("isEmpty", (params, state, subExp) =>
		appendDeclarationIfMissing(
			getLeftHandSideParent(subExp),
			`(next(${transpileExpression(state, subExp)}) == nil)`,
		),
	);

const OBJECT_REPLACE_METHODS: ReplaceMap = new Map<string, ReplaceFunction>().set("isEmpty", (params, state, subExp) =>
	appendDeclarationIfMissing(
		getLeftHandSideParent(subExp),
		`(next(${compileCallArguments(state, params)[0]}) == nil)`,
	),
);

const RBX_MATH_CLASSES = ["CFrame", "UDim", "UDim2", "Vector2", "Vector2int16", "Vector3", "Vector3int16"];

const GLOBAL_REPLACE_METHODS: ReplaceMap = new Map<string, ReplaceFunction>().set("typeIs", (params, state, subExp) => {
	const [obj, type] = compileCallArguments(state, params);
	return appendDeclarationIfMissing(getLeftHandSideParent(subExp, 2), `(typeof(${obj}) == ${type})`);
});

export function compileCallArguments(state: TranspilerState, args: Array<ts.Node>) {
	return args.map(arg => {
		if (!ts.TypeGuards.isSpreadElement(arg)) {
			checkNonAny(arg);
		}

		console.log(ts.TypeGuards.isExpression(arg), arg.getKindName(), arg.getText());
		return transpileExpression(state, arg as ts.Expression);
	});
}

export function transpileCallArguments(state: TranspilerState, args: Array<ts.Node>, extraParameter?: string) {
	const argStrs = compileCallArguments(state, args);

	if (extraParameter) {
		argStrs.unshift(extraParameter);
	}

	return argStrs.join(", ");
}

export function transpileCallExpression(
	state: TranspilerState,
	node: ts.CallExpression,
	doNotWrapTupleReturn = !isTupleReturnTypeCall(node),
) {
	const exp = node.getExpression();
	if (exp.getKindName() === "ImportKeyword") {
		throw new TranspilerError(
			"Dynamic import expressions are not supported! Use 'require()' instead and assert the type.",
			node,
			TranspilerErrorType.NoDynamicImport,
		);
	}
	checkNonAny(exp);
	let result: string;

	if (ts.TypeGuards.isPropertyAccessExpression(exp)) {
		result = transpilePropertyCallExpression(state, node);
	} else {
		const params = node.getArguments();

		if (ts.TypeGuards.isSuperExpression(exp)) {
			return `super.constructor(${transpileCallArguments(state, params, "self")})`;
		}

		const isSubstitutableMethod = GLOBAL_REPLACE_METHODS.get(exp.getText());

		if (isSubstitutableMethod) {
			const str = isSubstitutableMethod(params, state, exp);
			if (str) {
				return str;
			}
		}

		const callPath = transpileExpression(state, exp);
		result = `${callPath}(${transpileCallArguments(state, params)})`;
	}

	if (!doNotWrapTupleReturn) {
		result = `{ ${result} }`;
	}

	return result;
}

function transpilePropertyMethod(
	state: TranspilerState,
	property: string,
	params: Array<ts.Node>,
	subExp: ts.LeftHandSideExpression,
	className: string,
	replaceMethods: ReplaceMap,
) {
	const isSubstitutableMethod = replaceMethods.get(property);

	if (isSubstitutableMethod) {
		const str = isSubstitutableMethod(params, state, subExp);
		if (str) {
			return str;
		}
	}

	const accessPath = className === "Object" ? undefined : transpileExpression(state, subExp);
	state.usesTSLibrary = true;
	return `TS.${className}_${property}(${transpileCallArguments(state, params, accessPath)})`;
}

export const enum PropertyCallExpType {
	None = -1,
	Array,
	BuiltInStringMethod,
	String,
	PromiseThen,
	SymbolFor,
	Map,
	Set,
	ObjectConstructor,
	RbxMathAdd,
	RbxMathSub,
	RbxMathMul,
	RbxMathDiv,
}

export function getPropertyAccessExpressionType(
	state: TranspilerState,
	node: ts.CallExpression | ts.PropertyAccessExpression,
	expression: ts.PropertyAccessExpression,
): PropertyCallExpType {
	checkApiAccess(state, expression.getNameNode());

	const subExp = expression.getExpression();
	const subExpType = subExp.getType();
	const property = expression.getName();

	if (isArrayType(subExpType)) {
		return PropertyCallExpType.Array;
	}

	if (isStringType(subExpType)) {
		if (STRING_MACRO_METHODS.indexOf(property) !== -1) {
			return PropertyCallExpType.BuiltInStringMethod;
		}

		return PropertyCallExpType.String;
	}

	const subExpTypeSym = subExpType.getSymbol();
	if (subExpTypeSym && ts.TypeGuards.isPropertyAccessExpression(expression)) {
		const subExpTypeName = subExpTypeSym.getEscapedName();

		// custom promises
		if (subExpTypeName === "Promise") {
			if (property === "then") {
				return PropertyCallExpType.PromiseThen;
			}
		}

		// for is a reserved word in Lua
		if (subExpTypeName === "SymbolConstructor") {
			if (property === "for") {
				return PropertyCallExpType.SymbolFor;
			}
		}

		if (subExpTypeName === "Map" || subExpTypeName === "ReadonlyMap" || subExpTypeName === "WeakMap") {
			return PropertyCallExpType.Map;
		}

		if (subExpTypeName === "Set" || subExpTypeName === "ReadonlySet" || subExpTypeName === "WeakSet") {
			return PropertyCallExpType.Set;
		}

		if (subExpTypeName === "ObjectConstructor") {
			return PropertyCallExpType.ObjectConstructor;
		}

		// custom math
		if (RBX_MATH_CLASSES.indexOf(subExpTypeName) !== -1) {
			switch (property) {
				case "add":
					return PropertyCallExpType.RbxMathAdd;
				case "sub":
					return PropertyCallExpType.RbxMathSub;
				case "mul":
					return PropertyCallExpType.RbxMathMul;
				case "div":
					return PropertyCallExpType.RbxMathDiv;
			}
		}
	}

	return PropertyCallExpType.None;
}

export function transpilePropertyCallExpression(state: TranspilerState, node: ts.CallExpression) {
	const expression = getNonNull(node.getExpression());
	if (!ts.TypeGuards.isPropertyAccessExpression(expression)) {
		throw new TranspilerError(
			"Expected PropertyAccessExpression",
			node,
			TranspilerErrorType.ExpectedPropertyAccessExpression,
		);
	}

	checkApiAccess(state, expression.getNameNode());

	const subExp = getNonNull(expression.getExpression());
	const property = expression.getName();
	const params = node.getArguments();

	switch (getPropertyAccessExpressionType(state, node, expression)) {
		case PropertyCallExpType.Array:
			return transpilePropertyMethod(state, property, params, subExp, "array", ARRAY_REPLACE_METHODS);
		case PropertyCallExpType.BuiltInStringMethod:
			return `${wrapExpressionIfNeeded(state, subExp)}:${property}(${transpileCallArguments(state, params)})`;
		case PropertyCallExpType.String:
			return transpilePropertyMethod(state, property, params, subExp, "string", STRING_REPLACE_METHODS);
		case PropertyCallExpType.PromiseThen:
			return `${transpileExpression(state, subExp)}:andThen(${transpileCallArguments(state, params)})`;
		case PropertyCallExpType.SymbolFor:
			return `${transpileExpression(state, subExp)}.getFor(${transpileCallArguments(state, params)})`;
		case PropertyCallExpType.Map:
			return transpilePropertyMethod(state, property, params, subExp, "map", MAP_REPLACE_METHODS);
		case PropertyCallExpType.Set:
			return transpilePropertyMethod(state, property, params, subExp, "set", SET_REPLACE_METHODS);
		case PropertyCallExpType.ObjectConstructor:
			return transpilePropertyMethod(state, property, params, subExp, "Object", OBJECT_REPLACE_METHODS);
		case PropertyCallExpType.RbxMathAdd:
			return appendDeclarationIfMissing(
				node.getParent(),
				`(${transpileExpression(state, subExp)} + (${compileCallArguments(state, params)[0]}))`,
			);
		case PropertyCallExpType.RbxMathSub:
			return appendDeclarationIfMissing(
				node.getParent(),
				`(${transpileExpression(state, subExp)} - (${compileCallArguments(state, params)[0]}))`,
			);
		case PropertyCallExpType.RbxMathMul:
			return appendDeclarationIfMissing(
				node.getParent(),
				`(${transpileExpression(state, subExp)} * (${compileCallArguments(state, params)[0]}))`,
			);
		case PropertyCallExpType.RbxMathDiv:
			return appendDeclarationIfMissing(
				node.getParent(),
				`(${transpileExpression(state, subExp)} / (${compileCallArguments(state, params)[0]}))`,
			);
	}

	const expType = expression.getType();
	const allMethods = typeConstraint(expType, t =>
		t
			.getSymbolOrThrow()
			.getDeclarations()
			.every(dec => {
				if (ts.TypeGuards.isParameteredNode(dec)) {
					const thisParam = dec.getParameter("this");
					if (thisParam) {
						const structure = thisParam.getStructure();
						if (structure.type === "void") {
							return false;
						} else {
							return true;
						}
					}
				}
				if (ts.TypeGuards.isMethodDeclaration(dec) || ts.TypeGuards.isMethodSignature(dec)) {
					return true;
				}
				return false;
			}),
	);

	const allCallbacks = typeConstraint(expType, t =>
		t
			.getSymbolOrThrow()
			.getDeclarations()
			.every(dec => {
				if (ts.TypeGuards.isParameteredNode(dec)) {
					const thisParam = dec.getParameter("this");
					if (thisParam) {
						const structure = thisParam.getStructure();
						if (structure.type === "void") {
							return true;
						} else {
							return false;
						}
					}
				}

				if (
					ts.TypeGuards.isFunctionTypeNode(dec) ||
					ts.TypeGuards.isPropertySignature(dec) ||
					ts.TypeGuards.isFunctionExpression(dec) ||
					ts.TypeGuards.isArrowFunction(dec) ||
					ts.TypeGuards.isFunctionDeclaration(dec)
				) {
					return true;
				}
				return false;
			}),
	);

	let accessPath = transpileExpression(state, subExp);
	let sep: string;
	let extraParam = "";
	if (allMethods && !allCallbacks) {
		if (ts.TypeGuards.isSuperExpression(subExp)) {
			accessPath = "super.__index";
			extraParam = "self";
			sep = ".";
		} else {
			sep = ":";
		}
	} else if (!allMethods && allCallbacks) {
		sep = ".";
	} else {
		// mixed methods and callbacks
		throw new TranspilerError(
			"Attempted to call a function with mixed types! All definitions must either be a method or a callback.",
			node,
			TranspilerErrorType.MixedMethodCall,
		);
	}

	return `${accessPath}${sep}${property}(${transpileCallArguments(state, params, extraParam)})`;
}
